import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Clock, Effect, Layer, Stream } from 'effect'
import { SessionEvents } from './session-events.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { ThreadHostCallFailed } from './sidebar-errors.js'
import { SubscriptionNoticeModel, SubscriptionNotices, notifySubscribers, type DeliveryOutcome, type SubscriptionNoticeDeps } from './subscription-notices.js'
import { threadSubscriptionsApi } from './subscriptions-api.js'
import { ThreadSubscriptions } from './subscriptions-store.js'

const errorCodeOf = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'subscription-delivery-failed'

const catchDelivery = (error: unknown): DeliveryOutcome => ({
  delivered: false,
  code: errorCodeOf(error),
  detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
})

/** The live Host behind a notice: the Session list for archive and question state, the Session API for delivery. */
export const subscriptionNoticeHostLayer = Layer.effect(
  SubscriptionNotices,
  Effect.gen(function* () {
    const host = yield* HostContext
    const ctx = host.ctx
    const sessions = createHostApiClient(ctx, sessionsApi, host.packageId)
    const sidebar = yield* SidebarHost
    const deps: SubscriptionNoticeDeps = {
      stateOf: (sessionIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const archived = new Set(yield* sidebar.archivedSessionIds)
          const listed = yield* sidebar.sessions
          const pending = new Map(listed.map(session => [session.sessionId, session.pendingQuestions] as const))
          const titles = yield* Effect.tryPromise({
            try: signal =>
              ctx.sessionQuery.readTitleSnapshots(
                sessionIds.map(id => SessionId(id)),
                signal,
              ),
            catch: cause => new ThreadHostCallFailed({ cause }),
          })
          const bySession = new Map<string, string>()
          for (const result of titles) {
            if (result.status !== 'fulfilled' || result.value.title === undefined) continue
            bySession.set(result.sessionId, result.value.title.title)
          }
          return new Map(
            sessionIds.map(
              sessionId =>
                [sessionId, { archived: archived.has(sessionId), pendingQuestions: pending.get(sessionId) ?? 0, title: bySession.get(sessionId) }] as const,
            ),
          )
        }).pipe(
          Effect.mapError(cause => (cause instanceof ThreadHostCallFailed ? cause : new ThreadHostCallFailed({ cause }))),
          Effect.withSpan('thread subscription target state'),
        ),
      // `wake: true` is the whole opt-in: only a subscription reaches this call, so nothing else starts a thread's turn.
      deliver: input =>
        Effect.tryPromise({
          try: () => sessions.message({ sessionId: input.sessionId, text: input.text, target: 'next-turn', wake: true }),
          catch: cause => cause,
        }).pipe(
          Effect.as<DeliveryOutcome>({ delivered: true }),
          Effect.catch(error => Effect.succeed(catchDelivery(error))),
        ),
      messagesOf: sessionId =>
        Effect.tryPromise({
          try: signal => sessions.messages({ sessionId, limit: 8 }, { signal }),
          catch: cause => new ThreadHostCallFailed({ cause }),
        }).pipe(Effect.map(page => page.entries.map(entry => ({ role: entry.role, text: entry.text })))),
    }
    return SubscriptionNotices.of(deps)
  }),
)

/**
 * The watcher: one Session event stream, and for every turn end of a subscribed target one compact notice into the
 * subscriber. Nothing else wakes a thread — no subscription, no notice.
 */
export const subscriptionNoticer = Layer.effectDiscard(
  Effect.gen(function* () {
    const notices = yield* SubscriptionNotices
    const subscriptions = yield* ThreadSubscriptions
    const events = yield* (yield* SessionEvents).subscribe
    yield* DshxPlugin.worker(
      Stream.runForEach(events, ({ sessionId, event }) => {
        const finish = SubscriptionNoticeModel.finishOf(event)
        return finish === null ? Effect.void : notifySubscribers({ notices, subscriptions, targetSessionId: sessionId, finish })
      }),
    )
  }),
)

/** Every browser's thread menu re-reads at once, so a subscription made by an Agent shows without a reload. */
export const subscriptionChangeEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const subscriptions = yield* ThreadSubscriptions
    yield* subscriptions.changes.pipe(
      Stream.runForEach(() =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap(revision => Api.publish({ contract: threadSubscriptionsApi, event: 'changed', payload: { revision } })),
          Effect.catchTag('PublishEventError', error => Effect.logWarning('thread-sidebar: subscription change event refused', error.message)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)
