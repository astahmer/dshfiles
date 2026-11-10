import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { jsonStorageDomain } from './storage.test-support.js'
import { MAX_SUBSCRIPTIONS, ThreadSubscriptions, ThreadSubscriptionsModel } from './subscriptions-store.js'

const storeAt = (root: string) => ThreadSubscriptions.layer.pipe(Layer.provide(jsonStorageDomain(root)))

/** Run with a fresh storage root, the clock at `now`, and the store built after the clock is set. */
const withStore = <A, E>(now: number, body: (root: string) => Effect.Effect<A, E, ThreadSubscriptions>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now)
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'thread-subscriptions-' })
    return yield* body(root).pipe(Effect.provide(storeAt(root)))
  }).pipe(Effect.provide(NodeFileSystem.layer))

/** What a fresh store over the same root reads back: the durable edges. */
const durableRows = (root: string) =>
  Effect.map(
    ThreadSubscriptions.use(subscriptions => subscriptions.snapshot),
    snapshot => snapshot.subscriptions,
  ).pipe(Effect.provide(storeAt(root)))

const row = (subscriberSessionId: string, targetSessionId: string) => ({ subscriberSessionId, targetSessionId, createdAt: 1 })

describe('thread subscriptions', () => {
  it('a thread never watches itself, and a pair never wakes itself in both directions', () => {
    expect(ThreadSubscriptionsModel.refusalOf({ subscriberSessionId: 'a', targetSessionId: 'a', subscriptions: [] })).toContain('own completions')
    const mutual = ThreadSubscriptionsModel.refusalOf({ subscriberSessionId: 'a', targetSessionId: 'b', subscriptions: [row('b', 'a')] })
    expect(mutual).toContain('wake each other')
    expect(ThreadSubscriptionsModel.refusalOf({ subscriberSessionId: 'a', targetSessionId: 'b', subscriptions: [] })).toBeUndefined()
    expect(ThreadSubscriptionsModel.refusalOf({ subscriberSessionId: 'a', targetSessionId: 'c', subscriptions: [row('b', 'a')] })).toBeUndefined()
  })

  it('keys one edge per direction and trims the oldest first once over the bound', () => {
    expect(ThreadSubscriptionsModel.keyOf(row('a', 'b'))).not.toBe(ThreadSubscriptionsModel.keyOf(row('b', 'a')))
    const many = Array.from({ length: MAX_SUBSCRIPTIONS + 2 }, (_, index) => ({
      subscriberSessionId: `s${String(index)}`,
      targetSessionId: 't',
      createdAt: index,
    }))
    const trimmed = ThreadSubscriptionsModel.keysToTrim(many)
    expect(trimmed).toEqual([ThreadSubscriptionsModel.keyOf(row('s0', 't')), ThreadSubscriptionsModel.keyOf(row('s1', 't'))])
  })

  it.effect('an edge is durable, listed by its target, and removed by unsubscribing', () =>
    withStore(5_000, root =>
      Effect.gen(function* () {
        const subscriptions = yield* ThreadSubscriptions
        const stored = yield* subscriptions.subscribe({ subscriberSessionId: 'watcher', targetSessionId: 'target' })
        expect(stored.subscriptions).toEqual([{ subscriberSessionId: 'watcher', targetSessionId: 'target', createdAt: 5_000 }])
        expect(yield* subscriptions.edgesFor('target')).toEqual([{ subscriberSessionId: 'watcher', targetSessionId: 'target', createdAt: 5_000 }])
        expect(yield* subscriptions.edgesFor('watcher')).toEqual([])

        yield* subscriptions.subscribe({ subscriberSessionId: 'other', targetSessionId: 'target' })
        expect(yield* subscriptions.edgesFor('target')).toHaveLength(2)

        const after = yield* subscriptions.unsubscribe({ subscriberSessionId: 'watcher', targetSessionId: 'target' })
        expect(after.subscriptions).toEqual([{ subscriberSessionId: 'other', targetSessionId: 'target', createdAt: 5_000 }])
        return root
      }),
    ).pipe(Effect.tap(root => Effect.map(durableRows(root), rows => expect(rows).toHaveLength(1)))),
  )

  it.effect('pruning drops every edge of an archived thread on either end', () =>
    withStore(5_000, root =>
      Effect.gen(function* () {
        const subscriptions = yield* ThreadSubscriptions
        yield* subscriptions.subscribe({ subscriberSessionId: 'watcher', targetSessionId: 'target' })
        yield* subscriptions.subscribe({ subscriberSessionId: 'target', targetSessionId: 'downstream' })
        yield* subscriptions.subscribe({ subscriberSessionId: 'unrelated', targetSessionId: 'target' })

        expect(yield* subscriptions.prune(new Set(['target']))).toBe(3)
        expect(yield* subscriptions.snapshot).toEqual({ subscriptions: [] })
        expect(yield* subscriptions.prune(new Set(['target']))).toBe(0)
        return root
      }),
    ).pipe(Effect.tap(root => Effect.map(durableRows(root), rows => expect(rows).toEqual([])))),
  )
})
