import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Clock, Effect, Layer, Stream } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { ThreadAttentionStoreModel } from './attention-store.js'
import { NotificationHistory } from './notification-history.js'
import { SidebarOrganization } from './organization.js'
import { SessionEvents } from './session-events.js'
import { ThreadSidebarSettings } from './sidebar-settings.js'
import { ThreadNotificationModel } from './thread-notifications.js'

interface Lineage {
  readonly origin: SessionSummary['origin']
  readonly parentSessionId: SessionSummary['parentId']
}

const eventId = (input: { readonly source: 'finish' | 'request'; readonly sessionId: string; readonly identity: string; readonly category: string }) =>
  `${input.source}:${createHash('sha256')
    .update(JSON.stringify([input.sessionId, input.category, input.identity]))
    .digest('hex')}`

const lineageOf = (header: { readonly origin?: 'subagent'; readonly parentSession?: SessionSummary['parentId'] }): Lineage => ({
  origin: header.origin,
  parentSessionId: header.parentSession,
})

const logRecordingFailure = (cause: unknown) =>
  Effect.logWarning(
    'thread-sidebar: one notification history entry was not stored; the thread request continued. Check the Host log for the storage error',
    cause,
  )

/** Subagent and child Sessions are kept out of history exactly when their toasts are, so the two never disagree. */
export const notificationHistoryRecorder = Layer.effectDiscard(
  Effect.gen(function* () {
    const history = yield* NotificationHistory
    const settings = yield* ThreadSidebarSettings
    const events = yield* (yield* SessionEvents).subscribe
    const attentionIncluded = (lineage: Lineage) =>
      Effect.map(settings.get, value =>
        SidebarOrganization.isAttentionSessionIncluded({ origin: lineage.origin, parentId: lineage.parentSessionId }, value.includeSubagentAttention),
      )
    yield* DshxPlugin.worker(
      Stream.runForEach(events, event => {
        const reason = ThreadAttentionStoreModel.finishReasonFromEvent(event.event)
        if (reason === null) return Effect.void
        const category = ThreadNotificationModel.categoryForFinishReason(reason)
        return Effect.gen(function* () {
          if (!(yield* attentionIncluded(event))) return
          yield* history.record({
            id: eventId({ source: 'finish', sessionId: event.sessionId, category, identity: String(event.event.seq) }),
            sessionId: event.sessionId,
            at: event.event.time,
            category,
          })
        }).pipe(Effect.catchCause(logRecordingFailure))
      }),
    )
    yield* HostEvents.interceptAsync(
      'approval/request',
      ({ args: [request], next }) =>
        Effect.gen(function* () {
          const sessionId = String(request.agent.id)
          const category = 'approval-needed'
          if (!(yield* attentionIncluded(lineageOf(request.agent.session.header)))) return
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
          if (!(yield* attentionIncluded(lineageOf(request.agent.session.header)))) return
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
