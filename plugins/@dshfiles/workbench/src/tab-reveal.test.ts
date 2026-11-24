import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { revealOffset, TabReveal } from './tab-reveal.js'

const disposers: Array<() => void> = []

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => undefined
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const createApi = (): DockviewApi => {
  const element = document.createElement('div')
  document.body.append(element)
  const api = createDockview(element, { createComponent: () => ({ element: document.createElement('div'), init: () => undefined }) })
  api.layout(500, 300)
  disposers.push(() => api.dispose())
  return api
}

const rect = (left: number, right: number): DOMRect => ({
  left,
  right,
  top: 0,
  bottom: 20,
  width: right - left,
  height: 20,
  x: left,
  y: 0,
  toJSON: () => ({}),
})

const pinnedScroll = (strip: HTMLElement, scrollWidth = 500, clientWidth = 100): void => {
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: clientWidth })
}

const groupParts = (api: DockviewApi) => {
  const panel = api.panels[0]
  if (panel === undefined) throw new Error('Missing panel')
  const strip = panel.group.element.querySelector<HTMLElement>('.dv-tabs-container')
  const tab = panel.group.element.querySelector<HTMLElement>('.dv-tabs-container > .dv-tab.dv-active-tab')
  if (strip === null || tab === null) throw new Error('Missing tab strip')
  return { group: panel.group, strip, tab }
}

const openOverflowingTab = (api: DockviewApi) => {
  api.addPanel({ id: 'first', component: 'body', title: 'First' })
  const parts = groupParts(api)
  vi.spyOn(parts.strip, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
  vi.spyOn(parts.tab, 'getBoundingClientRect').mockReturnValue(rect(120, 200))
  pinnedScroll(parts.strip)
  return parts
}

describe('revealOffset', () => {
  it('asks for the pixels a clipped tab misses, and nothing when it fits', () => {
    expect(revealOffset(rect(0, 100), rect(20, 80))).toBe(0)
    expect(revealOffset(rect(0, 100), rect(-30, 40))).toBe(-30)
    expect(revealOffset(rect(0, 100), rect(80, 160))).toBe(60)
  })

  it('ignores sub-pixel clipping', () => {
    expect(revealOffset(rect(0, 100), rect(20, 100.4))).toBe(0)
  })
})

describe('TabReveal', () => {
  it('scrolls the strip itself once the layout settles, and never an ancestor', () => {
    const api = createApi()
    const { group, strip } = openOverflowingTab(api)
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    TabReveal.reveal(group)
    expect(strip.scrollLeft).toBe(0)
    vi.advanceTimersByTime(100)
    expect(strip.scrollLeft).toBe(100)
    expect(document.body.scrollLeft).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('waits for the last mounting part instead of correcting each one', () => {
    const api = createApi()
    const { group, strip } = openOverflowingTab(api)
    TabReveal.reveal(group)
    vi.advanceTimersByTime(50)
    TabReveal.reveal(group)
    vi.advanceTimersByTime(50)
    expect(strip.scrollLeft).toBe(0)
    vi.advanceTimersByTime(60)
    expect(strip.scrollLeft).toBe(100)
  })

  it('never scrolls past what the strip can scroll', () => {
    const api = createApi()
    const { group, strip, tab } = openOverflowingTab(api)
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(900, 980))
    pinnedScroll(strip, 250, 100)
    TabReveal.reveal(group)
    vi.advanceTimersByTime(100)
    expect(strip.scrollLeft).toBe(150)
  })

  it('re-reveals every group on window resize, and stops after disposal', () => {
    const api = createApi()
    openOverflowingTab(api)
    const disposed = TabReveal.retain(api)
    const reveal = vi.spyOn(TabReveal, 'reveal')
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect(reveal).toHaveBeenCalled()
    disposed()
    reveal.mockClear()
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect(reveal).not.toHaveBeenCalled()
  })
})
