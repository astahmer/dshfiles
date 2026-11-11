import { recordSpans } from '@dshfiles/dshx/tracing'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import type { UserNotification } from './user-notification-api.js'
import { UserNotificationRateLimit, UserNotifications } from './user-notification-host.js'

const agent = (sessionId: string) => ({ kind: 'agent' as const, sessionId, cwd: '/repo' })

const withNotifications = <A, E>(body: (published: UserNotification[]) => Effect.Effect<A, E, UserNotifications>) => {
  const published: UserNotification[] = []
  return body(published).pipe(Effect.provide(UserNotifications.layerWith(notification => Effect.sync(() => published.push(notification)))))
}

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

describe('UserNotifications.send', () => {
  it.effect('links the calling thread by default, none with null, and records a span', () =>
    withNotifications(published =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        const notifications = yield* UserNotifications
        const linked = yield* notifications
          .send({ title: 'Migration finished', body: 'Review the diff' }, agent('session-a'))
          .pipe(Effect.provide(DshxEffect.tracerLayer))
        expect(linked).toMatchObject({ status: 'sent', sessionId: 'session-a', retryAfterSeconds: null })
        const unlinked = yield* notifications.send({ title: 'Backup done', sessionId: null }, agent('session-b'))
        expect(unlinked.sessionId).toBeNull()
        expect(published).toEqual([
          { id: linked.id, title: 'Migration finished', body: 'Review the diff', sessionId: 'session-a' },
          { id: unlinked.id, title: 'Backup done', body: '', sessionId: null },
        ])
        expect(recorder.span('thread-sidebar user notification send').attributes['dshx.notification.status']).toBe('sent')
      }),
    ),
  )

  it.effect('refuses a fourth notification from one thread without publishing it, then allows it after the window', () =>
    withNotifications(published =>
      Effect.gen(function* () {
        const notifications = yield* UserNotifications
        for (const title of ['one', 'two', 'three']) expect((yield* notifications.send({ title }, agent('busy'))).status).toBe('sent')
        const refused = yield* notifications.send({ title: 'four' }, agent('busy'))
        expect(refused).toEqual({ status: 'rate-limited', id: null, sessionId: 'busy', retryAfterSeconds: 600 })
        expect(published.map(notification => notification.title)).toEqual(['one', 'two', 'three'])
        yield* TestClock.adjust('10 minutes')
        expect((yield* notifications.send({ title: 'later' }, agent('busy'))).status).toBe('sent')
      }),
    ),
  )
})
