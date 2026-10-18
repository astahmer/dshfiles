import { describe, expect, it, vi } from 'vitest'
import { createProjectionRefreshQueue } from './projection-refresh-queue.js'

describe('projection refresh queue', () => {
  it('refreshes each id once and never again after it succeeded', async () => {
    const refreshed: string[] = []
    const queue = createProjectionRefreshQueue({
      refresh: async sessionId => {
        refreshed.push(sessionId)
      },
    })
    queue.request(['a', 'b', 'a'], 'visible')
    await vi.waitFor(() => expect(queue.pending()).toBe(0))
    expect(refreshed).toEqual(['a', 'b'])

    queue.request(['a', 'b', 'c'], 'background')
    await vi.waitFor(() => expect(queue.pending()).toBe(0))
    expect(refreshed).toEqual(['a', 'b', 'c'])
  })

  it('bounds peak concurrency while it drains every id', async () => {
    const refreshed: string[] = []
    let active = 0
    let peak = 0
    const queue = createProjectionRefreshQueue({
      concurrency: 2,
      refresh: async sessionId => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        active -= 1
        refreshed.push(sessionId)
      },
    })
    const ids = Array.from({ length: 10 }, (_unused, index) => `s${String(index)}`)
    queue.request(ids, 'background')
    expect(queue.pending()).toBe(10)
    await vi.waitFor(() => expect(queue.pending()).toBe(0))
    expect(peak).toBe(2)
    expect(refreshed.sort()).toEqual([...ids].sort())
  })

  it('runs visible ids before the background ones still waiting', async () => {
    const order: string[] = []
    const queue = createProjectionRefreshQueue({
      concurrency: 1,
      refresh: async sessionId => {
        order.push(sessionId)
      },
    })
    queue.request(['b1', 'b2', 'b3'], 'background')
    queue.request(['v1'], 'visible')
    await vi.waitFor(() => expect(queue.pending()).toBe(0))
    expect(order).toEqual(['b1', 'v1', 'b2', 'b3'])
  })

  it('retries a failed id once and then leaves it unknown', async () => {
    vi.useFakeTimers()
    try {
      const attempts = new Map<string, number>()
      const queue = createProjectionRefreshQueue({
        retryDelayMs: 1_000,
        refresh: async sessionId => {
          attempts.set(sessionId, (attempts.get(sessionId) ?? 0) + 1)
          throw new Error('unavailable')
        },
      })
      queue.request(['x'], 'visible')
      await vi.advanceTimersByTimeAsync(0)
      expect(attempts.get('x')).toBe(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(attempts.get('x')).toBe(2)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(attempts.get('x')).toBe(2)
      expect(queue.pending()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops queued work when it is cancelled and refuses later requests', async () => {
    const refreshed: string[] = []
    const queue = createProjectionRefreshQueue({
      concurrency: 1,
      refresh: async sessionId => {
        refreshed.push(sessionId)
      },
    })
    queue.request(['a', 'b', 'c'], 'background')
    queue.cancel()
    queue.request(['d'], 'visible')
    await vi.waitFor(() => expect(queue.pending()).toBe(0))
    expect(refreshed).toEqual(['a'])
  })
})
