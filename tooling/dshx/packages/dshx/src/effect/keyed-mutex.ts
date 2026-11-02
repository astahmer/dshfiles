// Ported from opencode packages/core/src/effect/keyed-mutex.ts (MIT).
export * as KeyedMutex from './keyed-mutex.js'

import { Effect, Semaphore } from 'effect'

/** One lock per key: the same key queues, different keys run independently. */
export interface KeyedMutex<in Key> {
  /** Number of keys that have a holder or a waiter right now. */
  readonly size: Effect.Effect<number>
  readonly withLock: (key: Key) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

interface LockEntry {
  readonly semaphore: Semaphore.Semaphore
  users: number
}

/**
 * Create a keyed mutex outside an Effect. An entry counts its holder and waiters, so it is removed only when nobody
 * will reuse it, and interruption of a holder or waiter releases its count.
 */
export const makeUnsafe = <Key>(): KeyedMutex<Key> => {
  const locks = new Map<Key, LockEntry>()

  const withLock =
    (key: Key) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        const current = locks.get(key)
        const entry = current ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
        if (current === undefined) locks.set(key, entry)
        entry.users++
        return entry.semaphore.withPermit(effect).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users--
              if (entry.users === 0) locks.delete(key)
            }),
          ),
        )
      })

  return { size: Effect.sync(() => locks.size), withLock }
}

/** Create a keyed mutex inside an Effect workflow. */
export const make = <Key>(): Effect.Effect<KeyedMutex<Key>> => Effect.sync(() => makeUnsafe<Key>())
