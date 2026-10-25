import { describe, expect, test } from 'vitest'
import { createRepositoryViewsCache } from './repository-views-cache.js'

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('repository views cache', () => {
  test('returns cold and expired snapshots immediately while sharing one refresh', async () => {
    let now = 0
    let reads = 0
    const first = deferred<string>()
    const second = deferred<string>()
    const cache = createRepositoryViewsCache({
      read: () => {
        reads += 1
        return reads === 1 ? first.promise : second.promise
      },
      ttlMs: 10,
      now: () => now,
    })

    expect(cache.read()).toEqual({ value: undefined, refreshing: true, refreshFailed: false })
    expect(cache.read()).toEqual({ value: undefined, refreshing: true, refreshFailed: false })
    expect(reads).toBe(1)
    first.resolve('first')
    await expect(cache.refreshAndRead()).resolves.toBe('first')
    expect(cache.read()).toEqual({ value: 'first', refreshing: false, refreshFailed: false })

    now = 10
    expect(cache.read()).toEqual({ value: 'first', refreshing: true, refreshFailed: false })
    expect(cache.read()).toEqual({ value: 'first', refreshing: true, refreshFailed: false })
    expect(reads).toBe(2)
    second.resolve('second')
    await expect(cache.refreshAndRead()).resolves.toBe('second')
    expect(cache.read()).toEqual({ value: 'second', refreshing: false, refreshFailed: false })
  })

  test('preserves the last good snapshot after failure and retries after the cooldown', async () => {
    let now = 0
    let reads = 0
    const failed = deferred<string>()
    const cache = createRepositoryViewsCache({
      read: () => {
        reads += 1
        if (reads === 1) return Promise.resolve('last good')
        if (reads === 2) return failed.promise
        return Promise.resolve('recovered')
      },
      ttlMs: 10,
      now: () => now,
    })

    await expect(cache.refreshAndRead()).resolves.toBe('last good')
    now = 10
    expect(cache.read()).toEqual({ value: 'last good', refreshing: true, refreshFailed: false })
    failed.reject(new Error('scan failed'))
    await expect(cache.refreshAndRead()).rejects.toThrow('scan failed')
    expect(cache.read()).toEqual({ value: 'last good', refreshing: false, refreshFailed: true })
    expect(reads).toBe(2)

    now = 20
    expect(cache.read()).toEqual({ value: 'last good', refreshing: true, refreshFailed: false })
    await expect(cache.refreshAndRead()).resolves.toBe('recovered')
    expect(cache.read()).toEqual({ value: 'recovered', refreshing: false, refreshFailed: false })
  })

  test('does not publish a scan invalidated while it was running', async () => {
    const outdated = deferred<string>()
    const current = deferred<string>()
    let reads = 0
    const cache = createRepositoryViewsCache({
      read: () => {
        reads += 1
        return reads === 1 ? outdated.promise : current.promise
      },
      ttlMs: 10,
    })

    expect(cache.read()).toEqual({ value: undefined, refreshing: true, refreshFailed: false })
    const outdatedRead = cache.refreshAndRead()
    cache.invalidate()
    expect(cache.read()).toEqual({ value: undefined, refreshing: true, refreshFailed: false })
    const currentRead = cache.refreshAndRead()
    expect(reads).toBe(2)

    outdated.resolve('outdated')
    await expect(outdatedRead).resolves.toBe('outdated')
    expect(cache.read()).toEqual({ value: undefined, refreshing: true, refreshFailed: false })
    current.resolve('current')
    await expect(currentRead).resolves.toBe('current')
    expect(cache.read()).toEqual({ value: 'current', refreshing: false, refreshFailed: false })
  })

  test('starts an explicit refresh even when the cached view is still fresh', async () => {
    let reads = 0
    const next = deferred<string>()
    const cache = createRepositoryViewsCache({
      read: () => {
        reads += 1
        return reads === 1 ? Promise.resolve('before') : next.promise
      },
      ttlMs: 10_000,
    })

    await expect(cache.refreshAndRead()).resolves.toBe('before')
    expect(cache.startRefresh()).toBe(true)
    expect(cache.startRefresh()).toBe(false)
    expect(cache.read()).toEqual({ value: 'before', refreshing: true, refreshFailed: false })
    next.resolve('after')
    await expect(cache.refreshAndRead()).resolves.toBe('after')
    expect(cache.read()).toEqual({ value: 'after', refreshing: false, refreshFailed: false })
  })
})
