import { it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect } from 'vitest'
import { recurringTask } from './recurring-task.js'

describe('recurringTask', () => {
  it.effect('keeps running after a failing run', () =>
    Effect.gen(function* () {
      const outcomes: Array<'ran' | 'failed'> = []
      let runs = 0
      const fiber = yield* Effect.forkChild(
        recurringTask({
          run: async () => {
            runs += 1
            if (runs === 2) throw new Error('maintenance failed')
          },
          intervalMs: 1_000,
          onFailure: () => outcomes.push('failed'),
        }),
      )
      yield* TestClock.adjust('3500 millis')
      yield* Fiber.interrupt(fiber)
      expect(runs).toBe(4)
      expect(outcomes).toEqual(['failed'])
    }),
  )
})
