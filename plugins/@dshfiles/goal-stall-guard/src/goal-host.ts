import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session-projection'
import { HostContext } from '@dshfiles/dshx/effect'
import type { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Schema } from 'effect'

const operations = ['read', 'pause', 'extend', 'complete'] as const

/** The native goal service refused; its coded GoalError in `cause` reaches the agent unchanged. */
export class GoalServiceFailed extends Schema.TaggedError<GoalServiceFailed>()(
  'GoalServiceFailed',
  { operation: Schema.Literals(operations), goalId: Schema.optional(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'goal-service-failed' },
) {
  override get message(): string {
    return `The goal service could not ${this.operation} the goal${this.goalId === undefined ? '' : ` ${this.goalId}`}.`
  }
}

/** The native agents, goals and Session projections, as the plugin's own context injected them. */
export class GoalHost extends Context.Service<
  GoalHost,
  {
    readonly liveAgent: (sessionId: SessionId) => Agent | undefined
    /** The exact live agent of `agent.id`, in its own active turn. */
    readonly isInitiating: (agent: Agent) => boolean
    readonly openTurnStartSeq: (agent: Agent) => number | null | undefined
    readonly goal: (agent: Agent) => Effect.Effect<GoalView | undefined, GoalServiceFailed>
    readonly pause: (input: { readonly agent: Agent; readonly ref: GoalRef }) => Effect.Effect<GoalView, GoalServiceFailed>
    readonly extend: (input: { readonly agent: Agent; readonly ref: GoalRef; readonly maxGoalRounds: number }) => Effect.Effect<GoalView, GoalServiceFailed>
    readonly complete: (input: { readonly agent: Agent; readonly ref: GoalRef }) => Effect.Effect<GoalView, GoalServiceFailed>
    readonly warn: (message: string, ...values: readonly unknown[]) => Effect.Effect<void>
  }
>()('@dshfiles/goal-stall-guard/GoalHost') {
  static readonly layer = Layer.effect(
    GoalHost,
    Effect.gen(function* () {
      const ctx = (yield* HostContext).ctx
      const failed = (operation: (typeof operations)[number], goalId?: string) => (cause: unknown) => new GoalServiceFailed({ operation, goalId, cause })
      return GoalHost.of({
        liveAgent: sessionId => ctx.agents.get(sessionId),
        isInitiating: agent => ctx.agents.get(agent.id) === agent && ctx.agents.currentInitiator() === agent,
        openTurnStartSeq: agent => ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')?.openTurnStartSeq,
        goal: agent => Effect.try({ try: () => ctx.goals.get(agent), catch: failed('read') }),
        pause: input => Effect.try({ try: () => ctx.goals.pause(input.agent, input.ref), catch: failed('pause', input.ref.id) }),
        extend: input =>
          Effect.try({ try: () => ctx.goals.edit(input.agent, input.ref, { maxGoalRounds: input.maxGoalRounds }), catch: failed('extend', input.ref.id) }),
        complete: input => Effect.try({ try: () => ctx.goals.complete(input.agent, input.ref), catch: failed('complete', input.ref.id) }),
        warn: (message, ...values) => Effect.sync(() => ctx.logger.warn(message, ...values)),
      })
    }),
  )
}
