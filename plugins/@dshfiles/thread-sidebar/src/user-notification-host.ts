import { randomUUID } from 'node:crypto'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, HostContext } from '@dshfiles/dshx/effect'
import { Clock, Context, Deferred, Duration, Effect, Layer, Ref } from 'effect'
import {
  USER_NOTIFICATION_SKIP_REASONS,
  userNotificationApi,
  userNotificationRecovery,
  type UserNotification,
  type UserNotificationPageOutcome,
  type UserNotificationSendOutput,
  type UserNotificationSkipReason,
} from './user-notification-api.js'

type SentLog = ReadonlyMap<string, readonly number[]>

export type RateDecision = { readonly allowed: true; readonly sent: SentLog } | { readonly allowed: false; readonly retryAfterMs: number }

/** Sliding-window limits: a few per thread, and a total so many threads together cannot flood the user either. */
export class UserNotificationRateLimit {
  static readonly WINDOW_MS = 10 * 60_000
  static readonly PER_THREAD = 3
  static readonly TOTAL = 12

  static readonly decide = (input: { readonly sent: SentLog; readonly key: string; readonly now: number }): RateDecision => {
    const since = input.now - UserNotificationRateLimit.WINDOW_MS
    const recent = new Map<string, readonly number[]>()
    for (const [key, times] of input.sent) {
      const kept = times.filter(time => time > since)
      if (kept.length > 0) recent.set(key, kept)
    }
    const own = recent.get(input.key) ?? []
    const all = [...recent.values()].flat().toSorted((left, right) => left - right)
    // The send that must leave the window before another fits, for each limit that is full.
    const blocking = [
      own.length >= UserNotificationRateLimit.PER_THREAD ? own[own.length - UserNotificationRateLimit.PER_THREAD] : undefined,
      all.length >= UserNotificationRateLimit.TOTAL ? all[all.length - UserNotificationRateLimit.TOTAL] : undefined,
    ].filter(time => time !== undefined)
    if (blocking.length > 0) return { allowed: false, retryAfterMs: Math.max(...blocking) + UserNotificationRateLimit.WINDOW_MS - input.now }
    recent.set(input.key, [...own, input.now])
    return { allowed: true, sent: recent }
  }
}

/** How long send waits for open pages to say what they did; a page shows a notification within one event loop turn. */
export const USER_NOTIFICATION_ACK_WAIT = Duration.millis(1500)

/** Delivered when any page showed it; otherwise the first reason in list order, or no page at all. */
interface DeliverySettlement {
  readonly delivered: boolean
  readonly reason: UserNotificationSkipReason | null
}

export const settleDelivery = (outcomes: readonly UserNotificationPageOutcome[]): DeliverySettlement => {
  if (outcomes.includes('shown')) return { delivered: true, reason: null }
  const reason = USER_NOTIFICATION_SKIP_REASONS.find(candidate => outcomes.some(outcome => outcome === candidate)) ?? 'no-open-page'
  return { delivered: false, reason }
}

interface Pending {
  readonly outcomes: UserNotificationPageOutcome[]
  readonly shown: Deferred.Deferred<void>
}

const make = Effect.fnUntraced(function* (publish: (notification: UserNotification) => Effect.Effect<void>) {
  const sent = yield* Ref.make<SentLog>(new Map())
  const pending = new Map<string, Pending>()

  const acknowledge = (input: { readonly id: string; readonly outcome: UserNotificationPageOutcome }) =>
    Effect.gen(function* () {
      const entry = pending.get(input.id)
      if (entry === undefined) return { accepted: false }
      entry.outcomes.push(input.outcome)
      if (input.outcome === 'shown') yield* Deferred.succeed(entry.shown, undefined)
      return { accepted: true }
    })

  const send = Effect.fn('thread-sidebar user notification send')(function* (
    input: { readonly title: string; readonly body?: string | undefined; readonly sessionId?: string | null | undefined },
    caller: ApiCaller,
  ) {
    const callerSessionId = caller.kind === 'agent' ? caller.sessionId : undefined
    const sessionId = input.sessionId === undefined ? (callerSessionId ?? null) : input.sessionId
    const now = yield* Clock.currentTimeMillis
    const decision = yield* Ref.modify(sent, current => {
      const next = UserNotificationRateLimit.decide({ sent: current, key: callerSessionId ?? sessionId ?? 'user', now })
      return [next, next.allowed ? next.sent : current] as const
    })
    yield* Effect.annotateCurrentSpan({
      'dshx.notification.status': decision.allowed ? 'sent' : 'rate-limited',
      'dshx.notification.thread': sessionId !== null,
    })
    if (!decision.allowed)
      return {
        status: 'rate-limited',
        delivered: false,
        reason: null,
        recovery: null,
        id: null,
        sessionId,
        retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000),
      } satisfies UserNotificationSendOutput
    const id = randomUUID()
    const entry: Pending = { outcomes: [], shown: yield* Deferred.make<void>() }
    pending.set(id, entry)
    const settled = yield* Effect.gen(function* () {
      yield* publish({ id, title: input.title, body: input.body ?? '', sessionId })
      yield* Deferred.await(entry.shown).pipe(Effect.timeoutOption(USER_NOTIFICATION_ACK_WAIT))
      return settleDelivery(entry.outcomes)
    }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(id))))
    yield* Effect.annotateCurrentSpan({ 'dshx.notification.delivered': settled.delivered, 'dshx.notification.reason': settled.reason ?? 'none' })
    return {
      status: 'sent',
      delivered: settled.delivered,
      reason: settled.reason,
      recovery: settled.reason === null ? null : userNotificationRecovery[settled.reason],
      id,
      sessionId,
      retryAfterSeconds: null,
    } satisfies UserNotificationSendOutput
  })

  return { send, acknowledge }
})

/** Sends `notify_user` notifications to every open page, rate-limited per thread and in total. */
export class UserNotifications extends Context.Service<UserNotifications, Effect.Success<ReturnType<typeof make>>>()(
  '@dshfiles/thread-sidebar/UserNotifications',
) {
  static readonly layer = Layer.effect(
    UserNotifications,
    Effect.gen(function* () {
      const host = yield* HostContext
      return yield* make(payload =>
        // No open page means nobody to show it to: the event is not queued, and the tool still reports it as sent.
        Api.publish({ contract: userNotificationApi, event: 'sent', payload }).pipe(
          Effect.provideService(HostContext, host),
          Effect.catch(() => Effect.logDebug('thread-sidebar: the user notification event was not published')),
        ),
      )
    }),
  )

  static readonly layerWith = (publish: (notification: UserNotification) => Effect.Effect<void>) => Layer.effect(UserNotifications, make(publish))
}
