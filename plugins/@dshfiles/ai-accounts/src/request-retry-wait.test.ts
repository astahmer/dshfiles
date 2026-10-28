import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestRetryWait } from './request-retry-wait.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('per-thread retry wait lifecycle', () => {
  it('releases only the selected thread’s old wait without waiting for its reset', async () => {
    const waits = new RequestRetryWait()
    const first = waits.wait('first', 60_000, new AbortController().signal)
    let secondFinished = false
    const second = waits.wait('second', 60_000, new AbortController().signal).then(result => {
      secondFinished = true
      return result
    })
    waits.release('first')
    expect(await first).toBe(true)
    expect(secondFinished).toBe(false)
    waits.dispose()
    expect(await second).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps cancellation distinct from releasing an account-switch wait', async () => {
    const waits = new RequestRetryWait()
    const controller = new AbortController()
    const pending = waits.wait('first', 60_000, controller.signal)
    controller.abort()
    expect(await pending).toBe(false)
    waits.release('first')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans a replaced wait and ignores its late cancellation', async () => {
    const waits = new RequestRetryWait()
    const previous = new AbortController()
    const oldWait = waits.wait('first', 60_000, previous.signal)
    const newWait = waits.wait('first', 60_000, new AbortController().signal)
    expect(await oldWait).toBe(false)
    previous.abort()
    waits.release('first')
    expect(await newWait).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('settles normally on its timer and cleans listeners on disposal', async () => {
    const waits = new RequestRetryWait()
    const pending = waits.wait('first', 10, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10)
    expect(await pending).toBe(true)
    waits.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not create a timer for cancelled or zero-delay work', async () => {
    const waits = new RequestRetryWait()
    expect(await waits.wait('first', 10, AbortSignal.abort())).toBe(false)
    expect(await waits.wait('first', 0, new AbortController().signal)).toBe(true)
    waits.release('absent')
    expect(vi.getTimerCount()).toBe(0)
  })
})
