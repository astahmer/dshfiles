import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'

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
