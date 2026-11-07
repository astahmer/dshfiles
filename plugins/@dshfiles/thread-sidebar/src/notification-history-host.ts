import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Clock, Effect, Layer, Stream } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { ThreadAttentionStoreModel } from './attention-store.js'
import { NotificationHistory } from './notification-history.js'
import { SessionEvents } from './session-events.js'

const eventId = (input: { readonly source: 'finish' | 'request'; readonly sessionId: string; readonly identity: string; readonly category: string }) =>
  `${input.source}:${createHash('sha256')
    .update(JSON.stringify([input.sessionId, input.category, input.identity]))
    .digest('hex')}`

const logRecordingFailure = (cause: unknown) =>
  Effect.logWarning('thread-sidebar: notification history was not stored; check Host storage diagnostics and retry the history view', cause)

export const notificationHistoryRecorder = Layer.effectDiscard(
  Effect.gen(function* () {
    const history = yield* NotificationHistory
    const events = yield* (yield* SessionEvents).subscribe
    yield* DshxPlugin.worker(
      Stream.runForEach(events, ({ sessionId, event }) => {
        const reason = ThreadAttentionStoreModel.finishReasonFromEvent(event)
        if (reason === null) return Effect.void
        const category = reason === 'completed' ? 'turn-finished' : reason === 'error' ? 'failed' : 'stopped'
        return history
          .record({ id: eventId({ source: 'finish', sessionId, category, identity: String(event.seq) }), sessionId, at: event.time, category })
          .pipe(Effect.catchCause(logRecordingFailure))
      }),
    )
    yield* HostEvents.interceptAsync(
      'approval/request',
      ({ args: [request], next }) =>
        Effect.gen(function* () {
          const sessionId = String(request.agent.id)
          const category = 'approval-needed'
          yield* history.record({
            id: eventId({ source: 'request', sessionId, category, identity: randomUUID() }),
            sessionId,
            at: yield* Clock.currentTimeMillis,
            category,
          })
        }).pipe(Effect.catchCause(logRecordingFailure), Effect.andThen(next)),
      { prepend: true },
    )
    yield* HostEvents.interceptAsync(
      'user-questions/request',
      ({ args: [request], next }) =>
        Effect.gen(function* () {
          if (request.agent === undefined || request.questions.length === 0) return
          const sessionId = String(request.agent.id)
          const category = request.questions.some(question => question.intent?.kind === 'plan-review') ? 'approval-needed' : 'input-needed'
          const identity = request.wait?.callId ?? randomUUID()
          yield* history.record({
            id: eventId({ source: 'request', sessionId, category, identity }),
            sessionId,
            at: yield* Clock.currentTimeMillis,
            category,
          })
        }).pipe(Effect.catchCause(logRecordingFailure), Effect.andThen(next)),
      { prepend: true },
    )
  }),
)
