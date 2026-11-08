import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type { Session, SessionEvent, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Effect, Layer, Queue, Schema } from 'effect'
import { completeBlockedGoalTool, extendGoalBudgetTool } from './goal-continuation.js'
import { GoalHost } from './goal-host.js'
import { DEFAULT_STALL_POLICY, StallDetector } from './stall.js'

const configSchema = Schema.Struct({
  stallThreshold: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(50)).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_STALL_POLICY.threshold)),
  ),
}).pipe(Schema.withDecodingDefault(Effect.succeed({ stallThreshold: DEFAULT_STALL_POLICY.threshold })))

interface PendingPause {
  readonly agent: Agent
  readonly consecutiveEmptyRounds: number
  readonly round?: number
}

const runtimeContextSource = Schema.Struct({ source: Schema.Struct({ kind: Schema.Literal('runtime-context') }) })
const isRuntimeContext = Schema.is(runtimeContextSource)

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

/** Pause one stalled goal; a refusal is logged, never thrown back at the session loop. */
const pauseStalled = Effect.fn('goal stall pause')(
  function* (pending: PendingPause) {
    const host = yield* GoalHost
    // Yield first: a goal change cannot be appended while the turn/end event that queued it is still being published.
    yield* Effect.sleep('0 millis')
    const goal = yield* host.goal(pending.agent)
    if (goal === undefined || goal.phase !== 'active') return
    yield* host.pause({ agent: pending.agent, ref: { id: goal.id, revision: goal.revision } })
    yield* host.warn(
      'goal-stall-guard: paused goal "%s" after %d consecutive rounds produced no output (round %d)',
      goal.id,
      pending.consecutiveEmptyRounds,
      pending.round ?? 0,
    )
  },
  (effect, pending) =>
    effect.pipe(
      Effect.catchTag('GoalServiceFailed', error =>
        GoalHost.use(host => host.warn('goal-stall-guard: could not pause stalled goal "%s": %o', error.goalId ?? pending.agent.id, error)),
      ),
    ),
)

/** Watches every Session's goal rounds and queues a pause once `threshold` consecutive rounds said nothing. */
const stallGuard = (threshold: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* GoalHost
      const { ctx } = yield* HostContext
      const detectors = new Map<string, StallDetector>()
      const detectorFor = (sessionId: string): StallDetector => {
        const existing = detectors.get(sessionId)
        if (existing !== undefined) return existing
        const created = StallDetector({ threshold })
        detectors.set(sessionId, created)
        return created
      }
      const pendingPauses = yield* Queue.unbounded<PendingPause>()
      yield* DshxPlugin.worker(Effect.forever(Queue.take(pendingPauses).pipe(Effect.flatMap(pauseStalled))))
      // One fiber per Session event costs more than this handler does, so it stays a synchronous listener.
      const onSessionEvent = (session: Session, event: SessionEvent): void => {
        const detector = detectors.get(session.id)
        switch (event.type) {
          case 'turn/start':
            detectorFor(session.id).turnStarted()
            return
          case 'user/message': {
            // DSH appends its runtime-context snapshot after the turn's prompt; it is bookkeeping, not a new prompt,
            // and reading it as one dropped the goal round it follows.
            if (isRuntimeContext(event.data)) return
            const text = promptText(event.data)
            if (text.length > 0) detectorFor(session.id).promptEntered(text)
            return
          }
          case 'step/start':
            detector?.turnIdentified(event.data.turn)
            return
          case 'assistant/message':
            if (assistantSaidAnything(event.data)) detector?.contentProduced()
            return
          case 'turn/end': {
            if (detector === undefined) return
            const decision = detector.turnEnded()
            // A Session with no empty run left carries no state worth keeping between turns.
            if (decision.consecutiveEmptyRounds === 0) detectors.delete(session.id)
            if (!decision.stalled) return
            const agent = host.liveAgent(session.id)
            if (agent === undefined || agent.session !== session) return
            const pending: PendingPause = { agent, consecutiveEmptyRounds: decision.consecutiveEmptyRounds }
            Queue.offerUnsafe(pendingPauses, decision.round === undefined ? pending : { ...pending, round: decision.round })
            return
          }
          default:
            return
        }
      }
      yield* Effect.acquireRelease(Effect.sync(() => ctx.on('session/event', onSessionEvent)), dispose => Effect.sync(() => dispose()))
    }),
  )

export default DshxPlugin.make({
  name: 'dshfiles-goal-stall-guard',
  inject: ['agents', 'goals', 'sessions', 'sessionProjections'],
  Config: configSchema,
  layer: config => Layer.provideMerge(stallGuard(config.stallThreshold), GoalHost.layer),
  tools: [extendGoalBudgetTool, completeBlockedGoalTool],
})
