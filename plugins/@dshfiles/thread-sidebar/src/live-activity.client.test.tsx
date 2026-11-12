// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkingTabTitle } from './header-live-activity.js'
import { LiveActivityLine, LiveActivityModel, type LiveTurnView } from './live-activity.js'

const roots: Root[] = []
const render = async (element: JSX.Element): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 6, 0, 0, 0))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live activity line', () => {
  it('formats elapsed time compactly', () => {
    expect(LiveActivityModel.formatElapsed(9_400)).toBe('9s')
    expect(LiveActivityModel.formatElapsed(72_000)).toBe('1m 12s')
    expect(LiveActivityModel.formatElapsed(3_840_000)).toBe('1h 04m')
  })

  it('keeps an unchanged turn object, so memoised rows skip a poll', () => {
    const first: ReadonlyMap<string, LiveTurnView> = new Map([['a', { startedAt: 1_000, step: 'Thinking' }]])
    const same = LiveActivityModel.stabilize(first, new Map([['a', { startedAt: 1_400, step: 'Thinking' }]]))
    expect(same).toBe(first)
    const moved = LiveActivityModel.stabilize(first, new Map([['a', { startedAt: 1_000, step: 'Running pnpm test' }]]))
    expect(moved).not.toBe(first)
    expect(moved.get('a')?.step).toBe('Running pnpm test')
  })

  it('ticks every visible clock from one shared timer and pauses an off-screen one', async () => {
    const startedAt = Date.now() - 72_000
    const container = await render(
      <>
        <LiveActivityLine active startedAt={startedAt} step="Running pnpm test" />
        <LiveActivityLine active={false} startedAt={startedAt} step="Thinking" />
      </>,
    )
    const clocks = container.querySelectorAll('[data-live-elapsed]')
    expect(clocks[0]?.textContent).toBe('1m 12s')
    const timers = vi.getTimerCount()
    expect(timers).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(clocks[0]?.textContent).toBe('1m 15s')
    // Off screen: the clock keeps its last text and the shimmer is paused.
    expect(clocks[1]?.textContent).toBe('1m 12s')
    expect(container.querySelectorAll('[data-live-paused]')).toHaveLength(1)
    expect(container.textContent).toContain('Running pnpm test·1m 15s')
    // b:czs9: the header hides the clock and its separator by row width, so both are addressable.
    expect(container.querySelectorAll('[data-live-elapsed-separator]')).toHaveLength(2)
    expect(container.querySelector('[data-live-elapsed-separator]')?.nextElementSibling?.hasAttribute('data-live-elapsed')).toBe(true)
  })

  it('says Working without a clock when no start is known', async () => {
    const container = await render(<LiveActivityLine active startedAt={undefined} step="Working" />)
    expect(container.textContent).toBe('Working')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('working tab title', () => {
  const Title = (props: { readonly count: number }): null => {
    useWorkingTabTitle(props.count, true)
    return null
  }

  it('prefixes the count while threads work and restores the title after', async () => {
    document.title = 'Fix the build'
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Title count={2} />))
    expect(document.title).toBe('⟳ 2 · Fix the build')
    await act(async () => root.render(<Title count={0} />))
    expect(document.title).toBe('Fix the build')
  })
})
