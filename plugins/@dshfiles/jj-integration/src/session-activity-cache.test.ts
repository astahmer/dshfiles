import { describe, expect, test } from 'vitest'
import { createSessionActivityCache, type SessionActivity } from './session-activity-cache.js'

const activityOf = (sessionId: string, running: boolean): SessionActivity => new Map([[sessionId, { running, pendingUserQuestion: false }]])

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('session activity cache', () => {
  test('a first display read that outlives its budget resolves as unknown instead of hanging', async () => {
    const cache = createSessionActivityCache({
      read: async budgetMs => {
        expect(budgetMs).toBe(2_500)
        return undefined
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
    })

    await expect(cache.display()).resolves.toBeUndefined()
  })

  test('concurrent display reads share one bounded read', async () => {
    let reads = 0
    const pending = deferred<SessionActivity | undefined>()
    const cache = createSessionActivityCache({
      read: async () => {
        reads += 1
        return await pending.promise
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
    })

    const first = cache.display()
    const second = cache.display()
    expect(reads).toBe(1)
    pending.resolve(activityOf('session-a', true))
    await expect(first).resolves.toEqual(activityOf('session-a', true))
    await expect(second).resolves.toEqual(activityOf('session-a', true))
    expect(reads).toBe(1)
  })

  test('a stale display value is served at once while one background read refreshes it', async () => {
    let clock = 0
    let reads = 0
    const refresh = deferred<SessionActivity | undefined>()
    const cache = createSessionActivityCache({
      read: async () => {
        reads += 1
        return reads === 1 ? activityOf('session-a', true) : await refresh.promise
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
      now: () => clock,
    })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    clock = 30_001
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    expect(reads).toBe(2)

    refresh.resolve(activityOf('session-a', false))
    await new Promise(done => setTimeout(done, 0))
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', false))
    expect(reads).toBe(2)
  })

  test('a guard read bypasses the cache and publishes what it read', async () => {
    let reads = 0
    const cache = createSessionActivityCache({
      read: async () => {
        reads += 1
        return activityOf('session-a', reads === 1)
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
    })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    await expect(cache.guard()).resolves.toEqual(activityOf('session-a', false))
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', false))
    expect(reads).toBe(2)
  })

  test('a failed read keeps the last good value for display and reports unknown to the guard', async () => {
    let clock = 0
    let fail = false
    const cache = createSessionActivityCache({
      read: async () => (fail ? undefined : activityOf('session-a', true)),
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
      now: () => clock,
    })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    fail = true
    clock = 30_001
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    await expect(cache.guard()).resolves.toBeUndefined()
  })

  test('a failed read after an invalidation reports unknown instead of a stale value', async () => {
    let fail = false
    const cache = createSessionActivityCache({
      read: async () => (fail ? undefined : activityOf('session-a', true)),
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
    })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    fail = true
    cache.reset()
    await expect(cache.display()).resolves.toBeUndefined()
  })

  test('a throwing read is unknown rather than an unhandled rejection', async () => {
    const cache = createSessionActivityCache({
      read: async () => {
        throw new Error('session controller unavailable')
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15_000,
    })

    await expect(cache.display()).resolves.toBeUndefined()
    await expect(cache.guard()).resolves.toBeUndefined()
  })
})
