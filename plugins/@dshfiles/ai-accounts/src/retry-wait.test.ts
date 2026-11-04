import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { RetryWait } from './retry-wait.js'

const open = () => new AbortController().signal

describe('per-thread retry wait lifecycle', () => {
  it.effect('releases only the selected thread’s old wait without waiting for its reset', () =>
    Effect.gen(function* () {
      const waits = yield* RetryWait
      const first = yield* Effect.forkChild(waits.wait('first', 60_000, open()))
      const second = yield* Effect.forkChild(waits.wait('second', 60_000, open()))
      yield* Effect.yieldNow
      waits.release('first')

      expect(yield* Fiber.join(first)).toBe(true)
      expect(second.pollUnsafe()).toBeUndefined()
    }).pipe(Effect.provide(RetryWait.layer)),
  )

  it.effect('ends every pending wait when the plugin scope closes', () =>
    Effect.gen(function* () {
      const pending = yield* Effect.scoped(
        Effect.gen(function* () {
          const waits = yield* RetryWait.make
          const fiber = yield* Effect.forkDetach(waits.wait('first', 60_000, open()))
          yield* Effect.yieldNow
          return fiber
        }),
      )
      expect(yield* Fiber.join(pending)).toBe(false)
    }),
  )

  it.effect('keeps cancellation distinct from releasing an account-switch wait', () =>
    Effect.gen(function* () {
      const waits = yield* RetryWait
      const controller = new AbortController()
      const pending = yield* Effect.forkChild(waits.wait('first', 60_000, controller.signal))
      yield* Effect.yieldNow
      controller.abort()
      expect(yield* Fiber.join(pending)).toBe(false)
      waits.release('first')
    }).pipe(Effect.provide(RetryWait.layer)),
  )

  it.effect('ends a replaced wait and ignores its late cancellation', () =>
    Effect.gen(function* () {
      const waits = yield* RetryWait
      const previous = new AbortController()
      const oldWait = yield* Effect.forkChild(waits.wait('first', 60_000, previous.signal))
      yield* Effect.yieldNow
      const newWait = yield* Effect.forkChild(waits.wait('first', 60_000, open()))
      yield* Effect.yieldNow

      expect(yield* Fiber.join(oldWait)).toBe(false)
      previous.abort()
      waits.release('first')
      expect(yield* Fiber.join(newWait)).toBe(true)
    }).pipe(Effect.provide(RetryWait.layer)),
  )

  it.effect('opens the retry once its delay passes on the Clock', () =>
    Effect.gen(function* () {
      const waits = yield* RetryWait
      const pending = yield* Effect.forkChild(waits.wait('first', 10, open()))
      yield* TestClock.adjust('10 millis')
      expect(yield* Fiber.join(pending)).toBe(true)
    }).pipe(Effect.provide(RetryWait.layer)),
  )

  it.effect('answers at once for cancelled or zero-delay work', () =>
    Effect.gen(function* () {
      const waits = yield* RetryWait
      expect(yield* waits.wait('first', 10, AbortSignal.abort())).toBe(false)
      expect(yield* waits.wait('first', 0, open())).toBe(true)
      waits.release('absent')
    }).pipe(Effect.provide(RetryWait.layer)),
  )
})
