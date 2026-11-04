import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import type { AccountsUsage } from './api.js'
import { UsageReadFailed, UsageSnapshot } from './usage-snapshot.js'

/**
 * Pins the usage sweep's generation rule: a read that started before an invalidation answers its own caller but never
 * becomes the latest sweep, and a new read never joins the stale one.
 */
const usage = (label: string): AccountsUsage => ({ cards: [], readAt: label.length, hostName: 'host' })

const scriptedReads = Effect.gen(function* () {
  const pending = yield* Ref.make<ReadonlyArray<Deferred.Deferred<AccountsUsage, UsageReadFailed>>>([])
  const read = Effect.gen(function* () {
    const gate = yield* Deferred.make<AccountsUsage, UsageReadFailed>()
    yield* Ref.update(pending, current => [...current, gate])
    return yield* Deferred.await(gate)
  })
  const nth = (index: number) =>
    Effect.flatMap(Ref.get(pending), current => {
      const gate = current[index]
      return gate === undefined ? Effect.die(`read ${String(index)} never started`) : Effect.succeed(gate)
    })
  return { read, pending, nth }
})

const settle = Effect.andThen(Effect.yieldNow, Effect.yieldNow)

describe('usage cache generation', () => {
  it.effect('drops a pre-invalidation result even when nothing read since', () =>
    Effect.gen(function* () {
      const reads = yield* scriptedReads
      const snapshot = yield* UsageSnapshot.make({ read: reads.read, timeToLive: '30 seconds', timeout: '10 seconds' })
      const stale = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* snapshot.invalidate
      yield* Deferred.succeed(yield* reads.nth(0), usage('stale'))

      expect(yield* Fiber.join(stale)).toEqual(usage('stale'))
      expect(snapshot.latest()).toBeUndefined()
    }),
  )

  it.effect('starts a fresh read after an invalidation instead of joining the stale one', () =>
    Effect.gen(function* () {
      const reads = yield* scriptedReads
      const snapshot = yield* UsageSnapshot.make({ read: reads.read, timeToLive: '30 seconds', timeout: '10 seconds' })
      const stale = yield* Effect.forkChild(snapshot.get)
      const joined = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* snapshot.invalidate
      const fresh = yield* Effect.forkChild(snapshot.get)
      yield* settle

      expect(yield* Ref.get(reads.pending)).toHaveLength(2)
      yield* Deferred.succeed(yield* reads.nth(1), usage('fresh'))
      yield* Deferred.succeed(yield* reads.nth(0), usage('stale'))
      expect(yield* Fiber.joinAll([stale, joined, fresh])).toEqual([usage('stale'), usage('stale'), usage('fresh')])
      expect(snapshot.latest()).toEqual(usage('fresh'))
      expect(yield* snapshot.get).toEqual(usage('fresh'))
      expect(yield* Ref.get(reads.pending)).toHaveLength(2)
    }),
  )

  it.effect('serves the cached sweep until the time to live ends and refresh always reads again', () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const read = Effect.map(
        Ref.updateAndGet(count, current => current + 1),
        current => usage('x'.repeat(current)),
      )
      const snapshot = yield* UsageSnapshot.make({ read, timeToLive: '1 second', timeout: '10 seconds' })

      expect((yield* snapshot.get).readAt).toBe(1)
      yield* TestClock.adjust('999 millis')
      expect((yield* snapshot.get).readAt).toBe(1)
      expect((yield* snapshot.refresh).readAt).toBe(2)
      yield* TestClock.adjust('999 millis')
      expect((yield* snapshot.get).readAt).toBe(2)
      yield* TestClock.adjust('1 millis')
      expect((yield* snapshot.get).readAt).toBe(3)
    }),
  )

  it.effect('keeps the previous sweep when a read fails, and the next get reads again', () =>
    Effect.gen(function* () {
      const reads = yield* scriptedReads
      const snapshot = yield* UsageSnapshot.make({ read: reads.read, timeToLive: 0, timeout: '10 seconds' })
      const first = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* Deferred.succeed(yield* reads.nth(0), usage('first'))
      expect(yield* Fiber.join(first)).toEqual(usage('first'))

      const failing = yield* Effect.forkChild(Effect.flip(snapshot.get))
      yield* settle
      yield* Deferred.fail(yield* reads.nth(1), new UsageReadFailed({ cause: new Error('provider down') }))
      expect((yield* Fiber.join(failing)).message).toBe('provider down')
      expect(snapshot.latest()).toEqual(usage('first'))

      const retry = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* Deferred.succeed(yield* reads.nth(2), usage('recovered'))
      expect(yield* Fiber.join(retry)).toEqual(usage('recovered'))
    }),
  )

  it.effect('interrupts and fails a read that outlives the timeout without caching it', () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const read = Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
      const snapshot = yield* UsageSnapshot.make({ read, timeToLive: '30 seconds', timeout: '20 millis' })
      const pending = yield* Effect.forkChild(Effect.flip(snapshot.get))
      yield* TestClock.adjust('20 millis')

      expect((yield* Fiber.join(pending)).message).toBe('Account usage read timed out after 20 ms.')
      expect(yield* Deferred.isDone(interrupted)).toBe(true)
      expect(snapshot.latest()).toBeUndefined()
    }),
  )

  it.effect('shares one read between surfaces within the time to live, and an invalidation reads again', () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const read = Effect.map(
        Ref.updateAndGet(count, current => current + 1),
        current => usage('x'.repeat(current)),
      )
      const snapshot = yield* UsageSnapshot.make({ read, timeToLive: '30 seconds', timeout: '10 seconds' })

      expect((yield* Effect.all([snapshot.get, snapshot.get], { concurrency: 'unbounded' })).map(sweep => sweep.readAt)).toEqual([1, 1])
      yield* TestClock.adjust('29999 millis')
      expect((yield* snapshot.get).readAt).toBe(1)
      yield* snapshot.invalidate
      expect((yield* snapshot.get).readAt).toBe(2)
    }),
  )

  it.effect('lets a sweep that outlived its timeout go, so the next refresh recovers', () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const read = Effect.flatMap(
        Ref.updateAndGet(count, current => current + 1),
        current => (current === 1 ? Effect.never : Effect.succeed(usage('fresh'))),
      )
      const snapshot = yield* UsageSnapshot.make({ read, timeToLive: '30 seconds', timeout: '1 second' })
      const pending = yield* Effect.forkChild(Effect.flip(snapshot.refresh))
      yield* TestClock.adjust('1 second')

      expect((yield* Fiber.join(pending)).message).toBe('Account usage read timed out after 1000 ms.')
      expect(yield* snapshot.refresh).toEqual(usage('fresh'))
      expect(yield* Ref.get(count)).toBe(2)
    }),
  )

  it.effect('detaches a pre-sign-out sweep: its late result answers its caller and never repopulates the cache', () =>
    Effect.gen(function* () {
      const reads = yield* scriptedReads
      const snapshot = yield* UsageSnapshot.make({ read: reads.read, timeToLive: '30 seconds', timeout: '10 seconds' })
      const before = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* snapshot.invalidate
      const after = yield* Effect.forkChild(snapshot.get)
      yield* settle
      yield* Deferred.succeed(yield* reads.nth(1), usage('signed-out'))
      expect(yield* Fiber.join(after)).toEqual(usage('signed-out'))
      yield* Deferred.succeed(yield* reads.nth(0), usage('old-authenticated-quota'))

      expect(yield* Fiber.join(before)).toEqual(usage('old-authenticated-quota'))
      expect(snapshot.latest()).toEqual(usage('signed-out'))
      expect(yield* snapshot.get).toEqual(usage('signed-out'))
      expect(yield* Ref.get(reads.pending)).toHaveLength(2)
    }),
  )
})
