// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuotaClock } from './quota-clock.js'

// The status strip's reset times share one minute clock that also stops while the strip is off screen (b:jaz6).
let notify: ((entries: { isIntersecting: boolean }[]) => void) | undefined
const Clock = (props: { readonly element: Element | null; readonly onTick: (now: number) => void }): null => {
  props.onTick(useQuotaClock({ resetsAt: [], element: props.element }))
  return null
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        notify = callback
      }
      observe(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  notify = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useQuotaClock off screen', () => {
  it('stops ticking while its element is off screen and catches up when it returns', async () => {
    const ticks: number[] = []
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Clock element={container} onTick={now => ticks.push(now)} />))
    const minute = async (): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
    }
    await minute()
    const onScreen = new Set(ticks).size
    expect(onScreen).toBeGreaterThan(1)
    await act(async () => notify?.([{ isIntersecting: false }]))
    const hidden = new Set(ticks).size
    await minute()
    await minute()
    expect(new Set(ticks).size).toBe(hidden)
    await act(async () => notify?.([{ isIntersecting: true }]))
    expect(new Set(ticks).size).toBe(hidden + 1)
    await act(async () => root.unmount())
  })
})
