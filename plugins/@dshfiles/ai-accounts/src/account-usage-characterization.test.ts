import { describe, expect, it } from 'vitest'
import { createUsageCache } from './account-usage.js'

/**
 * Pins the usage cache's generation rule before an Effect `Cache` replaces it: a read that started before an
 * invalidation answers its own caller but never repopulates the cache, and a new read never joins the stale one.
 */
const gate = <Value>() => {
  let open: (value: Value) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const promise = new Promise<Value>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { promise, open, fail }
}

const scriptedReads = <Value>() => {
  const pending: Array<ReturnType<typeof gate<Value>>> = []
  const signals: AbortSignal[] = []
  const read = (signal: AbortSignal): Promise<Value> => {
    const next = gate<Value>()
    pending.push(next)
    signals.push(signal)
    return next.promise
  }
  return { read, pending, signals }
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('usage cache generation', () => {
  it('drops a pre-invalidation result even when nothing read since', async () => {
    const reads = scriptedReads<string>()
    const cache = createUsageCache({ ttlMs: 30_000, timeoutMs: 10_000, read: reads.read })
    const stale = cache.get()
    await flush()
    cache.invalidate()
    reads.pending[0]?.open('stale')

    expect(await stale).toBe('stale')
    expect(cache.latest()).toBeUndefined()
  })

  it('starts a fresh read after an invalidation instead of joining the stale one', async () => {
    const reads = scriptedReads<string>()
    const cache = createUsageCache({ ttlMs: 30_000, timeoutMs: 10_000, read: reads.read })
    const stale = cache.get()
    const joined = cache.get()
    await flush()
    cache.invalidate()
    const fresh = cache.get()
    await flush()

    expect(reads.pending).toHaveLength(2)
    reads.pending[1]?.open('fresh')
    reads.pending[0]?.open('stale')
    expect(await Promise.all([stale, joined, fresh])).toEqual(['stale', 'stale', 'fresh'])
    expect(cache.latest()).toBe('fresh')
    expect(await cache.get()).toBe('fresh')
    expect(reads.pending).toHaveLength(2)
  })

  it('serves the cached sweep until the ttl ends and refresh always reads again', async () => {
    let clock = 0
    let count = 0
    const cache = createUsageCache({ ttlMs: 1_000, timeoutMs: 10_000, now: () => clock, read: async () => ++count })

    expect(await cache.get()).toBe(1)
    clock = 999
    expect(await cache.get()).toBe(1)
    expect(await cache.refresh()).toBe(2)
    clock = 1_998
    expect(await cache.get()).toBe(2)
    clock = 1_999
    expect(await cache.get()).toBe(3)
  })

  it('keeps the previous sweep when a read fails, and the next get reads again', async () => {
    const reads = scriptedReads<string>()
    const cache = createUsageCache({ ttlMs: 0, timeoutMs: 10_000, read: reads.read })
    const first = cache.get()
    await flush()
    reads.pending[0]?.open('first')
    expect(await first).toBe('first')

    const failing = cache.get()
    await flush()
    reads.pending[1]?.fail(new Error('provider down'))
    await expect(failing).rejects.toThrow('provider down')
    expect(cache.latest()).toBe('first')

    const retry = cache.get()
    await flush()
    reads.pending[2]?.open('recovered')
    expect(await retry).toBe('recovered')
  })

  it('aborts and rejects a read that outlives the timeout without caching it', async () => {
    const reads = scriptedReads<string>()
    const cache = createUsageCache({ ttlMs: 30_000, timeoutMs: 20, read: reads.read })
    const settled = await cache.get().then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'rejected'),
    )

    expect(settled).toBe('Account usage read timed out after 20 ms.')
    expect(reads.signals[0]?.aborted).toBe(true)
    reads.pending[0]?.open('late')
    await flush()
    expect(cache.latest()).toBeUndefined()
  })
})
