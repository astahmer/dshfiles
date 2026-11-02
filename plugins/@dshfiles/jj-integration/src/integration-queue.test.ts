import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Queue, Ref, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { IntegrationWakeups } from './integration-queue.js'

/** Lets the merged stream's fibers run without moving the clock. */
const runPending = Effect.forEach(Array.from({ length: 5 }), () => Effect.yieldNow, { discard: true })

/** The wakeup stream the retry worker drains on, counted under a TestClock. */
const countWakeups = Effect.gen(function* () {
  const queued = yield* Queue.unbounded<void>()
  const sessionEvents = yield* Queue.unbounded<void>()
  const wakeups = yield* Ref.make(0)
  const fiber = yield* Effect.forkChild(
    Stream.runForEach(IntegrationWakeups.merge({ queued: Stream.fromQueue(queued), sessionEvents: Stream.fromQueue(sessionEvents) }), () =>
      Ref.update(wakeups, count => count + 1),
    ),
  )
  yield* TestClock.adjust(Duration.zero)
  return { queued, sessionEvents, wakeups, fiber }
})

describe('IntegrationWakeups', () => {
  it.effect('wakes at once when an integration is queued', () =>
    Effect.gen(function* () {
      const { queued, wakeups, fiber } = yield* countWakeups
      yield* Queue.offer(queued, undefined)
      yield* runPending
      expect(yield* Ref.get(wakeups)).toBe(1)
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect('wakes 1.5 s after the last of a burst of Session events', () =>
    Effect.gen(function* () {
      const { sessionEvents, wakeups, fiber } = yield* countWakeups
      yield* Queue.offer(sessionEvents, undefined)
      yield* TestClock.adjust(Duration.seconds(1))
      yield* Queue.offer(sessionEvents, undefined)
      yield* TestClock.adjust(Duration.seconds(1))
      expect(yield* Ref.get(wakeups)).toBe(0)
      yield* TestClock.adjust(Duration.millis(500))
      expect(yield* Ref.get(wakeups)).toBe(1)
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect('retries on the 30 s fallback when no Session event announced the idleness', () =>
    Effect.gen(function* () {
      const { wakeups, fiber } = yield* countWakeups
      yield* TestClock.adjust(Duration.seconds(29))
      expect(yield* Ref.get(wakeups)).toBe(0)
      yield* TestClock.adjust(Duration.seconds(1))
      expect(yield* Ref.get(wakeups)).toBe(1)
      yield* TestClock.adjust(IntegrationWakeups.fallbackInterval)
      expect(yield* Ref.get(wakeups)).toBe(2)
      yield* Fiber.interrupt(fiber)
    }),
  )
})
