import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import { defineTool } from '@dshfiles/dshx/host'
import { Effect, Schema } from 'effect'

const MAX_GOAL_ROUNDS = 256
const MAX_ROUND_EXTENSION = 32

const extensionInputSchema = Schema.Struct({
  additional_rounds: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_ROUND_EXTENSION })),
  progress: Schema.Trim.check(Schema.isMinLength(12), Schema.isMaxLength(2_000)),
  remaining_work: Schema.Trim.check(Schema.isMinLength(12), Schema.isMaxLength(2_000)),
  justification: Schema.Trim.check(Schema.isMinLength(12), Schema.isMaxLength(2_000)),
})

const blockedCompletionInputSchema = Schema.Struct({ evidence: Schema.Trim.check(Schema.isMinLength(12), Schema.isMaxLength(4_000)) })

class GoalContinuationFailure extends Schema.TaggedError<GoalContinuationFailure>()('GoalContinuationFailure', {
  message: Schema.String,
}) {}

const continuationFailure = (error: unknown) => new GoalContinuationFailure({ message: error instanceof Error ? error.message : String(error) })

const requireInitiatingAgent = (context: Context, agent: Agent | undefined): Agent => {
  if (agent === undefined) throw new Error('Goal continuation requires an active Agent.')
  if (context.agents.get(agent.id) !== agent || context.agents.currentInitiator() !== agent) {
    throw new Error('Goal continuation requires the exact live Agent in its active turn.')
  }
  return agent
}

const isCurrentGoalRound = (context: Context, agent: Agent, goal: GoalView): boolean => {
  const boundary = context.sessionProjections.stateOf(agent.session, 'turnBoundary')
  if (boundary === undefined || boundary.openTurnStartSeq === null) return false

  const events = agent.session.snapshotEvents()
  for (let seq = boundary.openTurnStartSeq + 1; seq < events.length; seq += 1) {
    const event = events[seq]
    if (
      event?.type === 'user/message' &&
      event.data.source.kind === 'goal' &&
      event.data.source.goalId === goal.id &&
      event.data.source.revision === goal.revision &&
      event.data.source.round === goal.roundsStarted
    ) {
      return true
    }
  }
  return false
}

const extendGoalBudget = Effect.fn('goal budget extend')(
  ({ context, args, agent }: { readonly context: Context; readonly args: unknown; readonly agent: Agent | undefined }) =>
    Effect.try({
      try: () => {
        const input = Schema.decodeUnknownSync(extensionInputSchema)(args)
        const initiatingAgent = requireInitiatingAgent(context, agent)
        const goal = context.goals.get(initiatingAgent)
        if (goal === undefined) throw new Error('There is no current goal to extend.')
        if (goal.phase !== 'active' || goal.roundsStarted !== goal.maxGoalRounds || !isCurrentGoalRound(context, initiatingAgent, goal)) {
          throw new Error('Budget extension is allowed only during the exact final active goal round.')
        }

        const maxGoalRounds = goal.maxGoalRounds + input.additional_rounds
        if (maxGoalRounds > MAX_GOAL_ROUNDS) throw new Error(`Goal extensions cannot exceed ${MAX_GOAL_ROUNDS} total rounds.`)

        const updated = context.goals.edit(initiatingAgent, { id: goal.id, revision: goal.revision }, { maxGoalRounds })
        return `Extended goal ${updated.id} from ${goal.maxGoalRounds} to ${updated.maxGoalRounds} rounds. The objective was unchanged.`
      },
      catch: continuationFailure,
    }),
)

const completeBlockedGoal = Effect.fn('goal blocked completion')(
  ({ context, args, agent }: { readonly context: Context; readonly args: unknown; readonly agent: Agent | undefined }) =>
    Effect.try({
      try: () => {
        const input = Schema.decodeUnknownSync(blockedCompletionInputSchema)(args)
        const initiatingAgent = requireInitiatingAgent(context, agent)
        const goal = context.goals.get(initiatingAgent)
        if (goal === undefined) throw new Error('There is no current goal to complete.')
        if (goal.phase !== 'blocked' || goal.blockedReason?.code !== 'round-limit') {
          throw new Error('This tool only completes a goal blocked by its round limit; use the native goal tool for active goals.')
        }

        const completed = context.goals.complete(initiatingAgent, { id: goal.id, revision: goal.revision })
        return `Marked goal ${completed.id} complete. Verification evidence: ${input.evidence}`
      },
      catch: continuationFailure,
    }),
)

const extendGoalBudgetTool = (context: Context) =>
  defineTool({
    name: 'extend_goal_budget',
    description:
      'Extend only the existing goal’s round budget, never its objective. Use only on that goal’s exact final active round, when concrete work remains within the user’s original objective and authorization. Give concrete progress, remaining work, and why another bounded set of rounds is justified. Adds 1–32 rounds, up to 256 total. Do not use merely to re-poll unchanged work waiting on user input.',
    parameters: {
      additional_rounds: {
        type: 'integer',
        required: true,
        description: 'Number of extra rounds, from 1 to 32.',
      },
      progress: {
        type: 'string',
        required: true,
        description: 'Concrete work completed or verified since the goal began.',
      },
      remaining_work: {
        type: 'string',
        required: true,
        description: 'Concrete work still outstanding within the existing objective.',
      },
      justification: {
        type: 'string',
        required: true,
        description: 'Why continuing remains within the human-authorized scope and time window.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args, execution) => Effect.runPromise(extendGoalBudget({ context, args, agent: execution.agent })),
  })

const completeBlockedGoalTool = (context: Context) =>
  defineTool({
    name: 'complete_blocked_goal',
    description:
      'Complete the current goal only when it is blocked because its round limit was reached and new evidence proves every objective requirement is satisfied. Provide concrete verification evidence; do not use while any task or user-dependent decision remains. This lets the owning Agent close a genuinely completed round-limited goal without a new human turn.',
    parameters: {
      evidence: {
        type: 'string',
        required: true,
        description: 'Concrete evidence that all goal requirements are complete and verified.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args, execution) => Effect.runPromise(completeBlockedGoal({ context, args, agent: execution.agent })),
  })

export const registerGoalContinuationTools = (context: Context): void => {
  context.tools.register(extendGoalBudgetTool(context))
  context.tools.register(completeBlockedGoalTool(context))
}
