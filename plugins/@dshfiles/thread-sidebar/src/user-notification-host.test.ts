import { recordSpans } from '@dshfiles/dshx/tracing'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { userNotificationApi, type UserNotification } from './user-notification-api.js'
import { USER_NOTIFICATION_ACK_WAIT, UserNotificationRateLimit, UserNotifications, settleDelivery } from './user-notification-host.js'

const agent = (sessionId: string) => ({ kind: 'agent' as const, sessionId, cwd: '/repo' })

/** A service whose publish makes each open page answer in turn, as a browser does when the event arrives. */
const answeringLayer = (answers: readonly ((id: string) => Effect.Effect<unknown, never, UserNotifications>)[]) =>
  Layer.effect(
    UserNotifications,
    Effect.gen(function* () {
      const self = yield* Deferred.make<Context.Service.Shape<typeof UserNotifications>>()
      const service = yield* UserNotifications.layerWith(notification =>
        Effect.flatMap(Deferred.await(self), resolved =>
          Effect.forEach(answers, answer => answer(notification.id).pipe(Effect.provideService(UserNotifications, resolved)), { discard: true }),
        ),
      ).pipe(
        Layer.build,
        Effect.map(context => Context.get(context, UserNotifications)),
      )
      yield* Deferred.succeed(self, service)
      return service
    }),
  )

describe('UserNotificationRateLimit.decide', () => {
  it('allows three per thread in ten minutes, then names when the oldest leaves the window', () => {
    let sent: ReadonlyMap<string, readonly number[]> = new Map()
    for (const now of [0, 1_000, 2_000]) {
      const decision = UserNotificationRateLimit.decide({ sent, key: 'a', now })
      expect(decision.allowed).toBe(true)
      if (decision.allowed) sent = decision.sent
    }
    expect(UserNotificationRateLimit.decide({ sent, key: 'a', now: 3_000 })).toEqual({ allowed: false, retryAfterMs: 597_000 })
    expect(UserNotificationRateLimit.decide({ sent, key: 'b', now: 3_000 }).allowed).toBe(true)
    expect(UserNotificationRateLimit.decide({ sent, key: 'a', now: 600_001 }).allowed).toBe(true)
  })

  it('caps the total across threads', () => {
    const sent = new Map(Array.from({ length: 12 }, (_, index) => [`thread-${String(index)}`, [index]] as const))
    expect(UserNotificationRateLimit.decide({ sent, key: 'new', now: 100 })).toEqual({ allowed: false, retryAfterMs: 599_900 })
  })
})

/** Runs one send while pages answer through `answer`, then lets the acknowledgement wait run out. */
const sendWith = (
  input: Parameters<Effect.Success<typeof UserNotifications>['send']>[0],
  caller: Parameters<Effect.Success<typeof UserNotifications>['send']>[1],
) =>
  Effect.gen(function* () {
    const notifications = yield* UserNotifications
    const fiber = yield* Effect.forkChild(notifications.send(input, caller))
    yield* TestClock.adjust(USER_NOTIFICATION_ACK_WAIT)
    return yield* Fiber.join(fiber)
  })

describe('settleDelivery', () => {
  it('is delivered when any page showed it, and otherwise names the first reason or no page', () => {
    expect(settleDelivery(['duplicate', 'shown'])).toEqual({ delivered: true, reason: null })
    expect(settleDelivery(['duplicate', 'watched-thread', 'snoozed'])).toEqual({ delivered: false, reason: 'snoozed' })
    expect(settleDelivery(['duplicate'])).toEqual({ delivered: false, reason: 'no-open-page' })
    expect(settleDelivery([])).toEqual({ delivered: false, reason: 'no-open-page' })
  })
})

describe('UserNotifications.send', () => {
  it.effect('links the calling thread by default, none with null, and records a span', () => {
    const published: UserNotification[] = []
    return Effect.gen(function* () {
      using recorder = recordSpans()
      const linked = yield* sendWith({ title: 'Migration finished', body: 'Review the diff' }, agent('session-a')).pipe(Effect.provide(DshxEffect.tracerLayer))
      expect(linked).toMatchObject({ status: 'sent', sessionId: 'session-a', retryAfterSeconds: null })
      const unlinked = yield* sendWith({ title: 'Backup done', sessionId: null }, agent('session-b'))
      expect(unlinked.sessionId).toBeNull()
      expect(published).toEqual([
        { id: linked.id, title: 'Migration finished', body: 'Review the diff', sessionId: 'session-a' },
        { id: unlinked.id, title: 'Backup done', body: '', sessionId: null },
      ])
      expect(recorder.span('thread-sidebar user notification send').attributes['dshx.notification.status']).toBe('sent')
    }).pipe(Effect.provide(UserNotifications.layerWith(notification => Effect.sync(() => published.push(notification)))))
  })

  it.effect('reports delivered once a page showed it, without waiting out the acknowledgement window', () =>
    Effect.gen(function* () {
      const notifications = yield* UserNotifications
      const output = yield* notifications.send({ title: 'Done' }, agent('session-a'))
      expect(output).toMatchObject({ status: 'sent', delivered: true, reason: null, recovery: null })
    }).pipe(
      Effect.provide(
        answeringLayer([
          id => UserNotifications.use(service => service.acknowledge({ id, outcome: 'duplicate' })),
          id => UserNotifications.use(service => service.acknowledge({ id, outcome: 'shown' })),
        ]),
      ),
    ),
  )

  it.effect('reports delivered: false with the reason and how to turn it on when every page skipped it', () =>
    Effect.gen(function* () {
      const output = yield* sendWith({ title: 'Done' }, agent('session-a'))
      expect(output).toMatchObject({ status: 'sent', delivered: false, reason: 'category-off' })
      expect(output.recovery).toContain('Agent messages is off')
      expect(output.recovery).toContain('Settings › Notifications › Thread notifications › Agent messages')
      expect(output.recovery).not.toContain('Input needed')
      const rendered = userNotificationApi.methods.send.tool?.render?.(output)
      expect(rendered).toContain('delivered: false')
      expect(rendered).toContain('Tell the user in your reply instead.')
    }).pipe(Effect.provide(answeringLayer([id => UserNotifications.use(service => service.acknowledge({ id, outcome: 'category-off' }))]))),
  )

  it.effect('reports no open page when nobody answers', () =>
    Effect.gen(function* () {
      const output = yield* sendWith({ title: 'Done' }, agent('session-a'))
      expect(output).toMatchObject({ delivered: false, reason: 'no-open-page', recovery: 'No DSH page is open to show it.' })
    }).pipe(Effect.provide(UserNotifications.layerWith(() => Effect.void))),
  )

  it.effect('refuses a fourth notification from one thread without publishing it, then allows it after the window', () => {
    const published: UserNotification[] = []
    return Effect.gen(function* () {
      for (const title of ['one', 'two', 'three']) expect((yield* sendWith({ title }, agent('busy'))).status).toBe('sent')
      const refused = yield* (yield* UserNotifications).send({ title: 'four' }, agent('busy'))
      expect(refused).toMatchObject({ status: 'rate-limited', delivered: false, id: null, sessionId: 'busy', retryAfterSeconds: 596 })
      expect(published.map(notification => notification.title)).toEqual(['one', 'two', 'three'])
      yield* TestClock.adjust('10 minutes')
      expect((yield* sendWith({ title: 'later' }, agent('busy'))).status).toBe('sent')
    }).pipe(Effect.provide(UserNotifications.layerWith(notification => Effect.sync(() => published.push(notification)))))
  })
})
