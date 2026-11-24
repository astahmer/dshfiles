import { createDockview, type DockviewApi, type DockviewGroupPanel } from 'dockview-react'
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

const overflowingParts = (group: DockviewGroupPanel) => {
  const strip = group.element.querySelector<HTMLElement>('.dv-tabs-container')
  const tab = group.element.querySelector<HTMLElement>('.dv-tabs-container > .dv-tab.dv-active-tab')
  if (strip === null || tab === null) throw new Error('Missing tab strip')
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(120, 200))
  pinnedScroll(strip)
  return { group, strip, tab }
}

const openOverflowingTab = (api: DockviewApi) => overflowingParts(api.addPanel({ id: 'first', component: 'body', title: 'First' }).group)

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
    const first = openOverflowingTab(api)
    const second = overflowingParts(api.addPanel({ id: 'second', component: 'body', position: { referencePanel: 'first', direction: 'right' } }).group)
    const release = TabReveal.retain(api)
    disposers.push(release)
    window.dispatchEvent(new Event('resize'))
    expect([first.strip.scrollLeft, second.strip.scrollLeft]).toEqual([0, 0])
    vi.advanceTimersByTime(100)
    expect([first.strip.scrollLeft, second.strip.scrollLeft]).toEqual([100, 100])

    window.dispatchEvent(new Event('resize'))
    release()
    vi.advanceTimersByTime(100)
    expect([first.strip.scrollLeft, second.strip.scrollLeft]).toEqual([100, 100])

    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect([first.strip.scrollLeft, second.strip.scrollLeft]).toEqual([100, 100])
  })

  it('reveals the selected tab after restoring a layout', () => {
    const source = createApi()
    source.addPanel({ id: 'restored', component: 'body' })
    const api = createApi()
    disposers.push(TabReveal.retain(api))
    api.fromJSON(source.toJSON())
    const panel = api.getPanel('restored')
    if (panel === undefined) throw new Error('Missing restored panel')
    const { strip } = overflowingParts(panel.group)
    expect(strip.scrollLeft).toBe(0)
    vi.advanceTimersByTime(100)
    expect(strip.scrollLeft).toBe(100)
  })
})
