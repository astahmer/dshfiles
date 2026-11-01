import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type { SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Queue, Schema } from 'effect'
import { DEFAULT_STALL_POLICY, StallDetector } from './stall.js'
import { registerGoalContinuationTools } from './goal-continuation.js'

const configSchema = Schema.Struct({
  stallThreshold: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(50)).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_STALL_POLICY.threshold)),
  ),
}).pipe(Schema.withDecodingDefault(Effect.succeed({ stallThreshold: DEFAULT_STALL_POLICY.threshold })))

export const Config = Schema.toStandardSchemaV1(configSchema)

type PluginConfig = Schema.Schema.Type<typeof configSchema>

interface PendingPause {
  readonly agent: Agent
  readonly consecutiveEmptyRounds: number
  readonly round?: number
}

type GoalStallRuntime = {
  readonly ctx: Context
  readonly detector: ReturnType<typeof StallDetector>
}

class GoalStallGuardRuntime extends EffectContext.Service<GoalStallGuardRuntime, GoalStallRuntime>()('@dshfiles/goal-stall-guard/Runtime') {}

class GoalPauseFailure extends Schema.TaggedError<GoalPauseFailure>()('GoalPauseFailure', { message: Schema.String }) {}

const runtimeContextSource = Schema.Struct({ source: Schema.Struct({ kind: Schema.Literal('runtime-context') }) })

/** The prompt a `user/message` event carried, as its text blocks read. */
const promptText = (data: UserMessage): string => {
  const texts: string[] = []
  for (const block of data.content) {
    if (block.type === 'text') texts.push(block.text)
  }
  return texts.join('\n')
}

/**
 * Whether the model left anything for the conversation.
 *
 * A tool call counts: the round did work, even with no prose. Reasoning counts
 * only when it also carries text, because the recorded failure was a completion
 * whose reasoning never reached the surface as an answer.
 */
const assistantSaidAnything = (data: SessionEventMap['assistant/message']): boolean =>
  data.message.content.some(block => {
    if (block.type === 'tool-call') return true
    if (block.type !== 'text' && block.type !== 'reasoning') return false
    return block.text.trim().length > 0
  })

const rootLayer = (ctx: Context, config: PluginConfig) =>
  Layer.succeed(GoalStallGuardRuntime, {
    ctx,
    detector: StallDetector({ threshold: config.stallThreshold ?? DEFAULT_STALL_POLICY.threshold }),
  })

const { hostApi: _hostApi, ...effectPlugin } = DshxEffect.plugin<PluginConfig, never, GoalStallGuardRuntime>({
  layer: rootLayer,
  setup: Effect.fn('goal stall guard setup')(function* (ctx: Context) {
    const runtime = yield* GoalStallGuardRuntime
    const detector = runtime.detector
    const pendingPauses = yield* Queue.unbounded<PendingPause>()
    registerGoalContinuationTools(ctx)
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const pending = yield* Queue.take(pendingPauses)
          yield* Effect.sleep('0 millis')
          const goal = ctx.goals.get(pending.agent)
          if (goal === undefined || goal.phase !== 'active') return
          yield* Effect.tryPromise({
            try: () => Promise.resolve(ctx.goals.pause(pending.agent, { id: goal.id, revision: goal.revision })),
            catch: error => new GoalPauseFailure({ message: error instanceof Error ? error.message : String(error) }),
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                ctx.logger.warn(
                  'goal-stall-guard: paused goal "%s" after %d consecutive rounds produced no output (round %d)',
                  goal.id,
                  pending.consecutiveEmptyRounds,
                  pending.round ?? 0,
                ),
              ),
            ),
            Effect.catchTag('GoalPauseFailure', error =>
              Effect.sync(() => ctx.logger.warn('goal-stall-guard: could not pause stalled goal "%s": %o', goal.id, error)),
            ),
          )
        }),
      ),
    )
    ctx.on('session/event', (session, event) => {
      switch (event.type) {
        case 'turn/start':
          detector.turnStarted()
          return
        case 'user/message': {
          // DSH appends its runtime-context snapshot after the turn's prompt; it is bookkeeping, not a new prompt, and
          // reading it as one dropped the goal round it follows.
          if (Schema.is(runtimeContextSource)(event.data)) return
          const text = promptText(event.data)
          if (text.length > 0) detector.promptEntered(text)
          return
        }
        case 'step/start':
          detector.turnIdentified(event.data.turn)
          return
        case 'assistant/message':
          if (assistantSaidAnything(event.data)) detector.contentProduced()
          return
        case 'turn/end': {
          const decision = detector.turnEnded()
          if (!decision.stalled) return
          const agent = ctx.agents.get(session.id)
          if (agent === undefined || agent.session !== session) return
          // Queue work for the scoped consumer, which waits until event publication unwinds.
          const pending: PendingPause = { agent, consecutiveEmptyRounds: decision.consecutiveEmptyRounds }
          if (decision.round === undefined) Queue.offerUnsafe(pendingPauses, pending)
          else Queue.offerUnsafe(pendingPauses, { ...pending, round: decision.round })
          return
        }
        default:
          return
      }
    })
    yield* Effect.void
  }),
})

export default defineHost({
  ...effectPlugin,
  Config,
  name: 'dshfiles-goal-stall-guard',
  inject: ['agents', 'goals', 'sessions', 'sessionProjections', 'tools'],
})

export { SessionId }
