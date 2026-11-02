import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { IntegrationRequests } from './integration-requests.js'

describe('IntegrationRequests', () => {
  it.layer(IntegrationRequests.layer)(it => {
    it.effect('records only actual queue and cancel transitions, scoped by workspace', () =>
      Effect.gen(function* () {
        const requests = yield* IntegrationRequests
        yield* TestClock.setTime(42)
        const first = yield* requests.queue({ path: '/repo/a', sessionId: undefined })
        expect(yield* requests.queue({ path: '/repo/a', sessionId: 'later' })).toBe(first)
        yield* requests.queue({ path: '/repo/b', sessionId: 'session-b' })
        expect(yield* requests.cancel('/repo/a')).toBe('cancelled')
        expect(yield* requests.cancel('/repo/a')).toBe('not-queued')
        expect(yield* requests.history('/repo/a')).toEqual([
          { at: 42, kind: 'queued' },
          { at: 42, kind: 'unqueued' },
        ])
        expect(yield* requests.history('/repo/b')).toEqual([{ at: 42, kind: 'queued', sessionId: 'session-b' }])
      }),
    )

    it.effect('bounds retained queue history', () =>
      Effect.gen(function* () {
        const requests = yield* IntegrationRequests
        for (let index = 0; index < 501; index += 1) {
          yield* requests.queue({ path: '/repo/bounded', sessionId: undefined })
          yield* requests.cancel('/repo/bounded')
        }
        expect((yield* requests.history('/repo/bounded')).length).toBeLessThanOrEqual(1_000)
      }),
    )

    it.effect('refuses a cancel once the attempt passed its guard, until the attempt ends', () =>
      Effect.gen(function* () {
        const requests = yield* IntegrationRequests
        const entry = yield* requests.queue({ path: '/repo/guarded', sessionId: undefined })
        expect(yield* requests.passGuard(entry)).toBe(true)
        expect(yield* requests.cancel('/repo/guarded')).toBe('integrating')
        expect(yield* requests.settle(entry)).toBe(true)
        yield* requests.endAttempt('/repo/guarded')
        expect(yield* requests.cancel('/repo/guarded')).toBe('not-queued')
      }),
    )

    it.effect('drops a cancelled entry without settling it, even when the attempt is in flight', () =>
      Effect.gen(function* () {
        const requests = yield* IntegrationRequests
        const entry = yield* requests.queue({ path: '/repo/cancelled', sessionId: undefined })
        expect(yield* requests.cancel('/repo/cancelled')).toBe('cancelled')
        expect(yield* requests.passGuard(entry)).toBe(false)
        expect(yield* requests.isCurrent(entry)).toBe(false)
        expect(yield* requests.settle(entry)).toBe(false)
      }),
    )

    it.effect('forgets integration progress after ten minutes', () =>
      Effect.gen(function* () {
        const requests = yield* IntegrationRequests
        yield* requests.recordProgress({ path: '/repo/progress', phase: 'rebasing' })
        expect(yield* requests.progress('/repo/progress')).toMatchObject({ phase: 'rebasing' })
        yield* TestClock.adjust(Duration.minutes(11))
        expect(yield* requests.progress('/repo/progress')).toBeNull()
      }),
    )
  })
})
