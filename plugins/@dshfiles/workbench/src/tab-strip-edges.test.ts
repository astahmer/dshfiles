import { describe, expect, it } from 'vitest'
import { TabStripEdges } from './tab-strip-edges.js'

const strip = (scrollLeft: number, scrollWidth: number, clientWidth: number) => ({ scrollLeft, scrollWidth, clientWidth })

describe('TabStripEdges', () => {
  it('names the edges where tabs are cut off', () => {
    expect(TabStripEdges.clipped(strip(0, 761, 761))).toBeUndefined()
    expect(TabStripEdges.clipped(strip(0, 1172, 761))).toBe('end')
    expect(TabStripEdges.clipped(strip(200, 1172, 761))).toBe('both')
    expect(TabStripEdges.clipped(strip(411, 1172, 761))).toBe('start')
    // Sub-pixel layout leaves a fraction of a pixel that is not a hidden tab.
    expect(TabStripEdges.clipped(strip(0.5, 761.4, 761))).toBeUndefined()
  })

  it('keeps the edge the selected tab sits on sharp, so the selected tab is never the faded one', () => {
    const both = strip(200, 1172, 761)
    expect(TabStripEdges.faded(both)).toBe('both')
    expect(TabStripEdges.faded(both, { start: 300, end: 450 })).toBe('both')
    expect(TabStripEdges.faded(both, { start: 0, end: 223 })).toBe('end')
    expect(TabStripEdges.faded(both, { start: 588, end: 761 })).toBe('start')
    expect(TabStripEdges.faded(strip(411, 1172, 761), { start: 0, end: 150 })).toBeUndefined()
    // A selected tab scrolled out of sight does not keep an edge sharp.
    expect(TabStripEdges.faded(both, { start: -300, end: -100 })).toBe('both')
  })

  it('marks a strip as it scrolls and clears the mark when everything fits', () => {
    const element = document.createElement('div')
    const metrics = { scrollLeft: 0, scrollWidth: 1172, clientWidth: 761 }
    for (const key of ['scrollLeft', 'scrollWidth', 'clientWidth'] as const)
      Object.defineProperty(element, key, { get: () => metrics[key], configurable: true })
    const release = TabStripEdges.watch(element)
    expect(element.getAttribute('data-workbench-tabs-clipped')).toBe('end')
    metrics.scrollLeft = 411
    element.dispatchEvent(new Event('scroll'))
    expect(element.getAttribute('data-workbench-tabs-clipped')).toBe('start')
    metrics.scrollLeft = 0
    metrics.scrollWidth = 761
    element.dispatchEvent(new Event('scroll'))
    expect(element.hasAttribute('data-workbench-tabs-clipped')).toBe(false)
    release()
    metrics.scrollWidth = 1172
    element.dispatchEvent(new Event('scroll'))
    expect(element.hasAttribute('data-workbench-tabs-clipped')).toBe(false)
  })
})
