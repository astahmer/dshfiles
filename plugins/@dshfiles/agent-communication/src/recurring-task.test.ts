import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { recurringTask } from './recurring-task.js'

describe('recurringTask', () => {
  it.effect('keeps running after a failing run', () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0)
      const failures = yield* Ref.make(0)
      const fiber = yield* Effect.forkChild(
        recurringTask({
          run: Effect.flatMap(
            Ref.updateAndGet(runs, count => count + 1),
            count => (count === 2 ? Effect.fail('maintenance failed') : Effect.void),
          ),
          interval: '1000 millis',
          onFailure: () => Ref.update(failures, count => count + 1),
        }),
      )
      yield* TestClock.adjust('3500 millis')
      yield* Fiber.interrupt(fiber)
      expect(yield* Ref.get(runs)).toBe(4)
      expect(yield* Ref.get(failures)).toBe(1)
    }),
  )
})
