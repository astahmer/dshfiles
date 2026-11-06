import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

describe('backlog revisions', () => {
  it.effect('announce every revision a write or a delete moves, so panels re-read on the changed event', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => Context.get(context, BacklogStore))
      const announced = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.revisions, 3)))
      yield* Effect.yieldNow
      const item = (yield* store.capture({ text: 'announce me', actor: user })).item
      const afterCapture = yield* store.revision
      yield* Effect.yieldNow
      yield* store.comment({ id: item.id, text: 'still here', actor: user })
      const afterComment = yield* store.revision
      yield* Effect.yieldNow
      yield* store.delete({ id: item.id })
      const afterDelete = yield* store.revision
      const revisions = yield* Fiber.join(announced)
      expect(revisions).toEqual([afterCapture, afterComment, afterDelete])
      expect(new Set(revisions).size).toBe(3)
    }).pipe(Effect.scoped),
  )
})
