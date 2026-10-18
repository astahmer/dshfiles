// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAnchorModel } from './memory-anchor.ts'

const tag = (): HTMLElement => {
  const element = document.createElement('span')
  element.textContent = 't:9356abc7'
  document.body.append(element)
  return element
}

const place = (element: HTMLElement, top: number, height = 16): void => {
  element.getBoundingClientRect = () => ({ left: 12, top, width: 80, height, right: 92, bottom: top + height, x: 12, y: top, toJSON: () => ({}) })
}

describe('memory anchor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('tags a reference once and finds it again by that id', () => {
    const element = tag()
    const anchorId = MemoryAnchorModel.idOf(element)
    expect(anchorId).toBeGreaterThan(0)
    expect(MemoryAnchorModel.idOf(element)).toBe(anchorId)
    expect(element.getAttribute(MemoryAnchorModel.attribute)).toBe(String(anchorId))
  })

  it('measures the reference while it is on screen', () => {
    const element = tag()
    place(element, 200)
    const anchorId = MemoryAnchorModel.idOf(element)
    expect(MemoryAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'rect', rect: { left: 12, top: 200, width: 80, height: 16 } })
  })

  it('reports a reference that scrolled past the viewport and one that is gone', () => {
    const element = tag()
    const anchorId = MemoryAnchorModel.idOf(element)
    place(element, -40)
    expect(MemoryAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'offscreen' })
    place(element, 920)
    expect(MemoryAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'offscreen' })
    element.remove()
    expect(MemoryAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'gone' })
  })
})
