import { describe, expect, it } from '@effect/vitest'
import { Effect, Random } from 'effect'
import { TestClock } from 'effect/testing'
import { AccountPool } from './account-pool.js'

const accounts = (ids: readonly string[]) => ids.map(id => ({ id, kind: 'codex', label: id }))

describe('AccountPool service', () => {
  it.effect('cools and recovers on the Clock it runs on', () =>
    Effect.gen(function* () {
      const pool = yield* AccountPool.make({ accounts: accounts(['a', 'b']), cooldownMs: 60_000 })
      yield* TestClock.setTime(1_000)
      pool.view.noteRateLimited('a', undefined)

      expect(pool.view.isHealthy('a')).toBe(false)
      expect((yield* pool.describe).map(account => [account.id, account.state, account.cooldownUntil])).toEqual([
        ['a', 'cooling', 61_000],
        ['b', 'healthy', undefined],
      ])
      yield* TestClock.adjust('60 seconds')
      expect(pool.view.isHealthy('a')).toBe(true)
    }),
  )

  it.effect('credits a served account at the Clock time and weighs balanced draws with Random', () =>
    Effect.gen(function* () {
      const draw = (seed: string) =>
        Effect.gen(function* () {
          const pool = yield* AccountPool.make({ accounts: accounts(['idle', 'fresh', 'third']), distribution: 'balanced' })
          yield* TestClock.setTime(10_000)
          yield* pool.noteServed('idle')
          yield* TestClock.adjust('12 seconds')
          return Array.from({ length: 20 }, () => pool.view.acquire({})?.id)
        }).pipe(Random.withSeed(seed))

      const first = yield* draw('pool')
      expect(yield* draw('pool')).toEqual(first)
      expect(new Set(first)).toEqual(new Set(['idle', 'fresh', 'third']))
      expect((yield* AccountPool.make({ accounts: [] })).view.acquire({})).toBeUndefined()
    }),
  )

  it.effect('applies a transaction and later Effect updates to the same state', () =>
    Effect.gen(function* () {
      const pool = yield* AccountPool.make({ accounts: accounts(['a', 'b']) })
      const taken = yield* pool.transact(view => [view.acquire({ conversationKey: 'one' })?.id, view.acquire({ conversationKey: 'two' })?.id])
      yield* pool.setDistribution('priority')
      yield* pool.replace([...accounts(['a']), { id: 'b', kind: 'codex', label: 'b', enabled: false }])

      expect(taken).toEqual(['a', 'b'])
      expect(yield* pool.distribution).toBe('priority')
      expect(pool.view.acquire({ conversationKey: 'two' })?.id).toBe('a')
    }),
  )
})
