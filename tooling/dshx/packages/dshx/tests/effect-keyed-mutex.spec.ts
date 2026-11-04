import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Ref } from 'effect'
import { KeyedMutex } from '../src/effect/keyed-mutex.js'

const hold = (input: {
  readonly mutex: KeyedMutex.KeyedMutex<string>
  readonly key: string
  readonly log: Ref.Ref<readonly string[]>
  readonly name: string
}) =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const fiber = yield* input.mutex
      .withLock(input.key)(
        Effect.gen(function* () {
          yield* Ref.update(input.log, entries => [...entries, `${input.name}:enter`])
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          yield* Ref.update(input.log, entries => [...entries, `${input.name}:exit`])
        }),
      )
      .pipe(Effect.forkChild)
    return { entered, release, fiber }
  })

describe('KeyedMutex', () => {
  it.effect('runs work on the same key one at a time', () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const log = yield* Ref.make<readonly string[]>([])
      const first = yield* hold({ mutex, key: 'repo', log, name: 'first' })
      yield* Deferred.await(first.entered)
      const second = yield* hold({ mutex, key: 'repo', log, name: 'second' })
      yield* Effect.yieldNow
      expect(yield* Ref.get(log)).toEqual(['first:enter'])
      expect(yield* mutex.size).toBe(1)

      yield* Deferred.succeed(first.release, undefined)
      yield* Deferred.await(second.entered)
      yield* Deferred.succeed(second.release, undefined)
      yield* Fiber.join(second.fiber)
      expect(yield* Ref.get(log)).toEqual(['first:enter', 'first:exit', 'second:enter', 'second:exit'])
    }),
  )

  it.effect('runs work on different keys at the same time', () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const log = yield* Ref.make<readonly string[]>([])
      const first = yield* hold({ mutex, key: 'a', log, name: 'a' })
      const second = yield* hold({ mutex, key: 'b', log, name: 'b' })
      yield* Deferred.await(first.entered)
      yield* Deferred.await(second.entered)
      expect(yield* mutex.size).toBe(2)
      yield* Deferred.succeed(first.release, undefined)
      yield* Deferred.succeed(second.release, undefined)
      yield* Fiber.join(first.fiber)
      yield* Fiber.join(second.fiber)
      expect([...(yield* Ref.get(log))].sort()).toEqual(['a:enter', 'a:exit', 'b:enter', 'b:exit'])
    }),
  )

  it.effect('removes a key once its last holder finishes, also on failure', () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      expect(yield* mutex.withLock('k')(Effect.succeed(1))).toBe(1)
      expect(yield* mutex.size).toBe(0)
      const failed = yield* mutex.withLock('k')(Effect.fail('boom')).pipe(Effect.flip)
      expect(failed).toBe('boom')
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.effect('releases the lock when a holder or a waiter is interrupted', () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const log = yield* Ref.make<readonly string[]>([])
      const holder = yield* hold({ mutex, key: 'k', log, name: 'holder' })
      yield* Deferred.await(holder.entered)
      const waiter = yield* hold({ mutex, key: 'k', log, name: 'waiter' })
      const next = yield* hold({ mutex, key: 'k', log, name: 'next' })
      yield* Effect.yieldNow

      yield* Fiber.interrupt(waiter.fiber)
      yield* Fiber.interrupt(holder.fiber)
      yield* Deferred.await(next.entered)
      yield* Deferred.succeed(next.release, undefined)
      yield* Fiber.join(next.fiber)

      expect(yield* Ref.get(log)).toEqual(['holder:enter', 'next:enter', 'next:exit'])
      expect(yield* mutex.size).toBe(0)
    }),
  )
})
