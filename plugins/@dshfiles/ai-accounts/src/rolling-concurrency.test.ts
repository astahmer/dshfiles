import { describe, expect, it } from 'vitest'
import { mapRolling, mapRollingUntilAborted } from './rolling-concurrency.js'

const deferred = () => {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

describe('rolling fan-out', () => {
  it('maps every item in input order while never exceeding the concurrency limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapRolling({
      items: Array.from({ length: 10 }, (_unused, index) => index),
      concurrency: 3,
      map: async item => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        active -= 1
        return item * 2
      },
    })
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
    expect(peak).toBe(3)
  })

  it('rolls past a slow item instead of waiting for its wave', async () => {
    const slow = deferred()
    const completed: number[] = []
    const pending = mapRolling({
      items: [0, 1, 2, 3],
      concurrency: 2,
      map: async item => {
        if (item === 0) await slow.promise
        completed.push(item)
      },
    })
    // Item 0 holds one worker; the other must already be running 1, 2 and 3 rather than waiting for it.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(completed).toEqual([1, 2, 3])
    slow.resolve()
    await pending
    expect(completed).toEqual([1, 2, 3, 0])
  })

  it('stops claiming new items once the signal aborts, leaving them unmapped', async () => {
    const controller = new AbortController()
    const started: number[] = []
    const results = await mapRollingUntilAborted({
      items: [0, 1, 2, 3, 4],
      concurrency: 1,
      signal: controller.signal,
      map: async item => {
        started.push(item)
        if (item === 0) controller.abort()
        return item
      },
    })
    expect(started).toEqual([0])
    expect(results).toEqual([0, undefined, undefined, undefined, undefined])
  })

  it('maps an empty list without starting a worker', async () => {
    await expect(mapRolling({ items: [], concurrency: 4, map: async () => 1 })).resolves.toEqual([])
  })
})
