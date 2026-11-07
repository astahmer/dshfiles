import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabReveal } from './tab-reveal.js'

class ObservedStrips {
  static instances: ObservedStrips[] = []
  readonly elements = new Set<Element>()
  readonly callback: ResizeObserverCallback
  private watching = true
  readonly disconnect = vi.fn(() => {
    this.watching = false
    this.elements.clear()
  })
  constructor(callback: ResizeObserverCallback) {
    this.callback = (...args) => {
      if (this.watching) callback(...args)
    }
    ObservedStrips.instances.push(this)
  }
  observe(element: Element): void {
    this.elements.add(element)
  }
  unobserve(element: Element): void {
    this.elements.delete(element)
  }
}

const disposers: Array<() => void> = []

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ObservedStrips)
  ObservedStrips.instances = []
})

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

describe('TabReveal', () => {
  it('reveals the selected tab of a group', () => {
    const api = createApi()
    const first = api.addPanel({ id: 'first', component: 'body', title: 'First' })
    api.addPanel({ id: 'second', component: 'body', title: 'Second' })
    api.getPanel('first')?.api.setActive()
    const tab = first.group.element.querySelector('.dv-tabs-container > .dv-tab.dv-active-tab')
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    TabReveal.reveal(first.group)
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' })
    expect(scrollIntoView.mock.instances[0]).toBe(tab)
  })

  it('re-reveals the selected tab when its strip resizes, and stops after disposal', () => {
    const api = createApi()
    const panel = api.addPanel({ id: 'first', component: 'body', title: 'First' })
    const strip = panel.group.element.querySelector('.dv-tabs-container')
    if (strip === null) throw new Error('Missing tab strip')
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    const dispose = TabReveal.retain(api)
    const observer = ObservedStrips.instances.at(-1)
    expect(observer?.elements.has(strip)).toBe(true)
    scrollIntoView.mockClear()
    observer?.callback([], observer)
    expect(scrollIntoView).toHaveBeenCalled()
    dispose()
    scrollIntoView.mockClear()
    observer?.callback([], observer)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(observer?.disconnect).toHaveBeenCalled()
  })

  it('leaves a strip alone once the user scrolls it away from the selection', () => {
    const api = createApi()
    const panel = api.addPanel({ id: 'first', component: 'body', title: 'First' })
    const strip = panel.group.element.querySelector('.dv-tabs-container')
    if (strip === null) throw new Error('Missing tab strip')
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    TabReveal.reveal(panel.group)
    scrollIntoView.mockClear()
    Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => 80 })
    const dispose = TabReveal.retain(api)
    const observer = ObservedStrips.instances.at(-1)
    observer?.callback([], observer)
    expect(scrollIntoView).not.toHaveBeenCalled()
    dispose()
  })
})
