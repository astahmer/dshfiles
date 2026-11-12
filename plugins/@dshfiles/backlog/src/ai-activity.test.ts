import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Stream } from 'effect'

import { AiActivity } from './ai-activity.js'

describe('AI activity tracking', () => {
  it.layer(AiActivity.layer)(it => {
    it.effect('stays active until every concurrent task finishes', () =>
      Effect.gen(function* () {
        const activity = yield* AiActivity
        const finishFirst = yield* Deferred.make<void>()
        const finishSecond = yield* Deferred.make<void>()
        const first = yield* Effect.forkChild(activity.track(Deferred.await(finishFirst)), { startImmediately: true })
        const second = yield* Effect.forkChild(activity.track(Deferred.await(finishSecond)), { startImmediately: true })

        expect(yield* activity.isActive).toBe(true)
        yield* Deferred.succeed(finishFirst, undefined)
        yield* Fiber.join(first)
        expect(yield* activity.isActive).toBe(true)
        yield* Deferred.succeed(finishSecond, undefined)
        yield* Fiber.join(second)
        expect(yield* activity.isActive).toBe(false)
      }),
    )

    it.effect('announces one busy and one idle flip for overlapping work', () =>
      Effect.gen(function* () {
        const activity = yield* AiActivity
        const flips = yield* Effect.forkChild(Stream.runCollect(Stream.take(activity.activeChanges, 2)), { startImmediately: true })
        yield* Effect.yieldNow
        const finishFirst = yield* Deferred.make<void>()
        const first = yield* Effect.forkChild(activity.track(Deferred.await(finishFirst)), { startImmediately: true })
        const second = yield* Effect.forkChild(activity.track(Effect.void), { startImmediately: true })
        yield* Fiber.join(second)
        yield* Deferred.succeed(finishFirst, undefined)
        yield* Fiber.join(first)
        expect(Array.from(yield* Fiber.join(flips))).toEqual([true, false])
      }),
    )

    it.effect('clears activity when the work fails', () =>
      Effect.gen(function* () {
        const activity = yield* AiActivity
        const error = yield* Effect.flip(activity.track(Effect.fail('failed')))
        expect(error).toBe('failed')
        expect(yield* activity.isActive).toBe(false)
      }),
    )
  })
})
