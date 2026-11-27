// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { revealOffset, revealTabInStrip } from './strip-scroll.js'

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

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

const scrollerWith = (left: number, right: number): HTMLDivElement => {
  const scroller = document.createElement('div')
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(left, right))
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 500 })
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 })
  document.body.append(scroller)
  return scroller
}

const tabWith = (left: number, right: number): HTMLDivElement => {
  const tab = document.createElement('div')
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(left, right))
  return tab
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('revealOffset', () => {
  it('asks for the pixels a clipped tab misses, and nothing when it fits', () => {
    expect(revealOffset(rect(0, 100), rect(20, 80))).toBe(0)
    expect(revealOffset(rect(0, 100), rect(-30, 40))).toBe(-30)
    expect(revealOffset(rect(0, 100), rect(80, 160))).toBe(60)
    expect(revealOffset(rect(0, 100), rect(20, 100.4))).toBe(0)
  })
})

describe('revealTabInStrip', () => {
  it('scrolls the strip by the missing pixels only', () => {
    const scroller = scrollerWith(0, 100)
    revealTabInStrip(scroller, tabWith(120, 200))
    expect(scroller.scrollLeft).toBe(100)
  })

  it('never scrolls the page or the frame around the strip', () => {
    const scroller = scrollerWith(0, 100)
    const frame = document.createElement('div')
    document.body.append(frame)
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    revealTabInStrip(scroller, tabWith(120, 200))
    expect(document.body.scrollLeft).toBe(0)
    expect(frame.scrollLeft).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('never scrolls past the end when the tab sits outside the scrollable content', () => {
    const scroller = scrollerWith(0, 100)
    revealTabInStrip(scroller, tabWith(900, 980))
    expect(scroller.scrollLeft).toBe(400)
  })

  it('does nothing for a tab already inside, or without a tab', () => {
    const scroller = scrollerWith(0, 100)
    const write = vi.spyOn(scroller, 'scrollLeft', 'set')
    revealTabInStrip(scroller, tabWith(10, 90))
    revealTabInStrip(scroller, null)
    expect(write).not.toHaveBeenCalled()
  })
})
