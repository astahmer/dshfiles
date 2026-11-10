import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, PubSub, Schema, Stream, SynchronizedRef } from 'effect'
import { SubscriptionStorageFailed } from './sidebar-errors.js'
import { type ThreadSubscription, type ThreadSubscriptionsSnapshot } from './subscriptions-api.js'

/** Two ids and when the edge was stored; titles are read at the boundary, never duplicated into storage. */
const storedSubscriptionSchema = Schema.Struct({
  subscriberSessionId: Schema.String.check(Schema.isMinLength(1)),
  targetSessionId: Schema.String.check(Schema.isMinLength(1)),
  createdAt: Schema.Number.check(Schema.isFinite()),
})

export const threadSubscriptionsDomain = defineDomain({
  name: 'thread_subscriptions',
  version: 1,
  tables: {
    subscriptions: { valueSchema: zodSchemaFromEffect(storedSubscriptionSchema), __key: 'subscriptions' },
  },
})

/**
 * Edges kept at most — the same bound the API carries, so a real edge is never trimmed off a full snapshot, and a bug
 * that subscribes in a loop cannot grow the domain without bound.
 */
export const MAX_SUBSCRIPTIONS = 500

const SEPARATOR = '\u001f'

const keyOf = (input: { readonly subscriberSessionId: string; readonly targetSessionId: string }): string =>
  `${input.subscriberSessionId}${SEPARATOR}${input.targetSessionId}`

/**
 * Why an edge cannot exist, or undefined when it can. A thread never watches itself, and a pair never watches itself
 * in both directions: two threads that wake each other on every completion would keep each other running forever.
 */
const refusalOf = (input: {
  readonly subscriberSessionId: string
  readonly targetSessionId: string
  readonly subscriptions: ReadonlyArray<ThreadSubscription>
}): string | undefined => {
  if (input.subscriberSessionId === input.targetSessionId) return 'A thread cannot be notified about its own completions: it already knows when its turn ends.'
  const mutual = input.subscriptions.some(edge => edge.subscriberSessionId === input.targetSessionId && edge.targetSessionId === input.subscriberSessionId)
  return mutual
    ? `${input.targetSessionId} already notifies ${input.subscriberSessionId}, so these two would wake each other on every completion. Drop that one first if you want the other direction.`
    : undefined
}

const snapshotOf = (subscriptions: readonly ThreadSubscription[]): ThreadSubscriptionsSnapshot => ({
  subscriptions: [...subscriptions].sort(
    (left, right) => left.subscriberSessionId.localeCompare(right.subscriberSessionId) || left.targetSessionId.localeCompare(right.targetSessionId),
  ),
})

/** The oldest edges go first once the store exceeds its bound. */
const keysToTrim = (subscriptions: readonly ThreadSubscription[], limit = MAX_SUBSCRIPTIONS): readonly string[] =>
  [...subscriptions]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, Math.max(0, subscriptions.length - limit))
    .map(keyOf)

export class ThreadSubscriptionsModel {
  static readonly keyOf = keyOf
  static readonly refusalOf = refusalOf
  static readonly snapshotOf = snapshotOf
  static readonly keysToTrim = keysToTrim
}

type Operation = SubscriptionStorageFailed['operation']

/**
 * The Host's durable thread subscriptions, in the `thread_subscriptions` storage domain. One row per edge, written
 * before the in-memory mirror moves, so a restart keeps both what the Agent subscribed and what the sidebar shows.
 */
export class ThreadSubscriptions extends Context.Service<
  ThreadSubscriptions,
  {
    readonly snapshot: Effect.Effect<ThreadSubscriptionsSnapshot>
    /** Every committed change, after the mirror moved; read `snapshot` for the state. */
    readonly changes: Stream.Stream<void>
    readonly edgesFor: (targetSessionId: string) => Effect.Effect<ReadonlyArray<ThreadSubscription>>
    readonly subscribe: (input: {
      readonly subscriberSessionId: string
      readonly targetSessionId: string
    }) => Effect.Effect<ThreadSubscriptionsSnapshot, SubscriptionStorageFailed>
    readonly unsubscribe: (input: {
      readonly subscriberSessionId: string
      readonly targetSessionId: string
    }) => Effect.Effect<ThreadSubscriptionsSnapshot, SubscriptionStorageFailed>
    /** Drop every edge with an archived endpoint, and answer how many went. */
    readonly prune: (sessionIds: ReadonlySet<string>) => Effect.Effect<number, SubscriptionStorageFailed>
  }
>()('@dshfiles/thread-sidebar/ThreadSubscriptions') {
  static readonly layer = Layer.effect(
    ThreadSubscriptions,
    Effect.gen(function* () {
      const domain = yield* (yield* StorageDomain)
        .open(threadSubscriptionsDomain)
        .pipe(Effect.mapError(cause => new SubscriptionStorageFailed({ operation: 'open', cause })))
      const table = domain.table('subscriptions')
      const stored = yield* table.entries.pipe(Effect.mapError(cause => new SubscriptionStorageFailed({ operation: 'open', cause })))
      const changed = yield* PubSub.sliding<void>(16)
      const state = yield* SynchronizedRef.make<ReadonlyArray<ThreadSubscription>>(stored.map(([, row]) => row))

      const plan = (
        current: ReadonlyArray<ThreadSubscription>,
        select: (subscriptions: ReadonlyArray<ThreadSubscription>) => {
          readonly put: ReadonlyArray<ThreadSubscription>
          readonly remove: ReadonlyArray<string>
        },
      ) => {
        const change = select(current)
        const kept = new Map(current.map(row => [keyOf(row), row] as const))
        for (const key of change.remove) kept.delete(key)
        for (const row of change.put) kept.set(keyOf(row), row)
        const trim = keysToTrim([...kept.values()])
        for (const key of trim) kept.delete(key)
        return { change, trim, next: [...kept.values()] }
      }

      const apply = (operation: Operation, select: Parameters<typeof plan>[1]) =>
        SynchronizedRef.modifyEffect(state, current =>
          Effect.gen(function* () {
            const { change, trim, next } = plan(current, select)
            const puts = change.put.filter(row => next.some(candidate => keyOf(candidate) === keyOf(row)))
            yield* Effect.forEach(puts, row => table.put(keyOf(row), row), { discard: true })
            yield* Effect.forEach([...change.remove, ...trim], key => table.delete(key), { discard: true })
            return [snapshotOf(next), next] as const
          }).pipe(Effect.mapError(cause => new SubscriptionStorageFailed({ operation, cause }))),
        ).pipe(Effect.tap(() => PubSub.publish(changed, undefined)))

      return ThreadSubscriptions.of({
        snapshot: Effect.map(SynchronizedRef.get(state), snapshotOf),
        changes: Stream.fromPubSub(changed),
        edgesFor: targetSessionId => Effect.map(SynchronizedRef.get(state), edges => edges.filter(edge => edge.targetSessionId === targetSessionId)),
        subscribe: Effect.fn('thread subscriptions subscribe')(function* (input) {
          const createdAt = yield* Clock.currentTimeMillis
          return yield* apply('subscribe', () => ({
            put: [{ subscriberSessionId: input.subscriberSessionId, targetSessionId: input.targetSessionId, createdAt }],
            remove: [],
          }))
        }),
        unsubscribe: Effect.fn('thread subscriptions unsubscribe')(function* (input) {
          return yield* apply('unsubscribe', () => ({ put: [], remove: [keyOf(input)] }))
        }),
        prune: Effect.fn('thread subscriptions prune')(function* (sessionIds) {
          if (sessionIds.size === 0) return 0
          const before = yield* SynchronizedRef.get(state)
          const remove = before.filter(edge => sessionIds.has(edge.subscriberSessionId) || sessionIds.has(edge.targetSessionId)).map(keyOf)
          if (remove.length === 0) return 0
          yield* apply('prune', () => ({ put: [], remove }))
          return remove.length
        }),
      })
    }),
  )
}
