import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { GoalHost } from './goal-host.js'

const MAX_GOAL_ROUNDS = 256
const MAX_ROUND_EXTENSION = 32

const statement = (input: { readonly description: string; readonly maxLength: number }) =>
  Schema.String.annotate({ description: input.description }).pipe(
    Schema.decodeTo(Schema.Trim.check(Schema.isMinLength(12), Schema.isMaxLength(input.maxLength))),
  )

const extensionInput = Schema.Struct({
  additional_rounds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_ROUND_EXTENSION })).annotate({
    description: 'Number of extra rounds, from 1 to 32.',
  }),
  progress: statement({ description: 'Concrete work completed or verified since the goal began.', maxLength: 2_000 }),
  remaining_work: statement({ description: 'Concrete work still outstanding within the existing objective.', maxLength: 2_000 }),
  justification: statement({ description: 'Why continuing remains within the human-authorized scope and time window.', maxLength: 2_000 }),
})

const blockedCompletionInput = Schema.Struct({
  evidence: statement({ description: 'Concrete evidence that all goal requirements are complete and verified.', maxLength: 4_000 }),
})

const refusals = ['no-agent', 'not-initiating', 'no-goal-to-extend', 'not-final-round', 'over-cap', 'no-goal-to-complete', 'not-round-limited'] as const

class GoalContinuationRefused extends Schema.TaggedError<GoalContinuationRefused>()(
  'GoalContinuationRefused',
  { reason: Schema.Literals(refusals), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'goal-continuation-refused' },
) {
  override get message(): string {
    switch (this.reason) {
      case 'no-agent':
        return 'Goal continuation requires an active Agent.'
      case 'not-initiating':
        return 'Goal continuation requires the exact live Agent in its active turn.'
      case 'no-goal-to-extend':
        return 'There is no current goal to extend.'
      case 'not-final-round':
        return 'Budget extension is allowed only during the exact final active goal round.'
      case 'over-cap':
        return `Goal extensions cannot exceed ${MAX_GOAL_ROUNDS} total rounds.`
      case 'no-goal-to-complete':
        return 'There is no current goal to complete.'
      case 'not-round-limited':
        return 'This tool only completes a goal blocked by its round limit; use the native goal tool for active goals.'
    }
  }
}

const initiatingAgent = Effect.fn('goal initiating agent')(function* (agent: Agent | undefined) {
  if (agent === undefined) return yield* new GoalContinuationRefused({ reason: 'no-agent' })
  const host = yield* GoalHost
  if (!host.isInitiating(agent)) return yield* new GoalContinuationRefused({ reason: 'not-initiating' })
  return agent
})

const isCurrentGoalRound = (input: { readonly openTurnStartSeq: number | null | undefined; readonly agent: Agent; readonly goal: GoalView }): boolean => {
  if (input.openTurnStartSeq === undefined || input.openTurnStartSeq === null) return false
  const events = input.agent.session.snapshotEvents()
  for (let seq = input.openTurnStartSeq + 1; seq < events.length; seq += 1) {
    const event = events[seq]
    if (
      event?.type === 'user/message' &&
      event.data.source.kind === 'goal' &&
      event.data.source.goalId === input.goal.id &&
      event.data.source.revision === input.goal.revision &&
      event.data.source.round === input.goal.roundsStarted
    ) {
      return true
    }
  }
  return false
}

export const extendGoalBudgetTool = Tool.make({
  name: 'extend_goal_budget',
  description:
    'Extend only the existing goal’s round budget, never its objective. Use only on that goal’s exact final active round, when concrete work remains within the user’s original objective and authorization. Give concrete progress, remaining work, and why another bounded set of rounds is justified. Adds 1–32 rounds, up to 256 total. Do not use merely to re-poll unchanged work waiting on user input.',
  input: extensionInput,
  output: Schema.String,
  render: text => text,
  execute: Effect.fn('goal budget extend')(function* (input, call) {
    const host = yield* GoalHost
    const agent = yield* initiatingAgent(call.agent)
    const goal = yield* host.goal(agent)
    if (goal === undefined) return yield* new GoalContinuationRefused({ reason: 'no-goal-to-extend' })
    const finalRound =
      goal.phase === 'active' &&
      goal.roundsStarted === goal.maxGoalRounds &&
      isCurrentGoalRound({ openTurnStartSeq: host.openTurnStartSeq(agent), agent, goal })
    if (!finalRound) return yield* new GoalContinuationRefused({ reason: 'not-final-round' })
    const maxGoalRounds = goal.maxGoalRounds + input.additional_rounds
    if (maxGoalRounds > MAX_GOAL_ROUNDS) return yield* new GoalContinuationRefused({ reason: 'over-cap' })
    const updated = yield* host.extend({ agent, ref: { id: goal.id, revision: goal.revision }, maxGoalRounds })
    return `Extended goal ${updated.id} from ${goal.maxGoalRounds} to ${updated.maxGoalRounds} rounds. The objective was unchanged.`
  }),
})

export const completeBlockedGoalTool = Tool.make({
  name: 'complete_blocked_goal',
  description:
    'Complete the current goal only when it is blocked because its round limit was reached and new evidence proves every objective requirement is satisfied. Provide concrete verification evidence; do not use while any task or user-dependent decision remains. This lets the owning Agent close a genuinely completed round-limited goal without a new human turn.',
  input: blockedCompletionInput,
  output: Schema.String,
  render: text => text,
  execute: Effect.fn('goal blocked completion')(function* (input, call) {
    const host = yield* GoalHost
    const agent = yield* initiatingAgent(call.agent)
    const goal = yield* host.goal(agent)
    if (goal === undefined) return yield* new GoalContinuationRefused({ reason: 'no-goal-to-complete' })
    if (goal.phase !== 'blocked' || goal.blockedReason?.code !== 'round-limit') return yield* new GoalContinuationRefused({ reason: 'not-round-limited' })
    const completed = yield* host.complete({ agent, ref: { id: goal.id, revision: goal.revision } })
    return `Marked goal ${completed.id} complete. Verification evidence: ${input.evidence}`
  }),
})
