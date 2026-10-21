// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { BacklogAnchorModel } from './backlog-anchor.js'

const tag = (): HTMLElement => {
  const element = document.createElement('span')
  element.textContent = 'b:12'
  document.body.append(element)
  return element
}

const place = (element: HTMLElement, top: number, height = 16): void => {
  element.getBoundingClientRect = () => ({ left: 12, top, width: 32, height, right: 44, bottom: top + height, x: 12, y: top, toJSON: () => ({}) })
}

describe('backlog reference anchor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('tags a reference once and finds it again by that id', () => {
    const element = tag()
    const anchorId = BacklogAnchorModel.idOf(element)
    expect(anchorId).toBeGreaterThan(0)
    expect(BacklogAnchorModel.idOf(element)).toBe(anchorId)
    expect(element.getAttribute(BacklogAnchorModel.attribute)).toBe(String(anchorId))
  })

  it('measures the reference while it is on screen', () => {
    const element = tag()
    place(element, 200)
    const anchorId = BacklogAnchorModel.idOf(element)
    expect(BacklogAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'rect', rect: { left: 12, top: 200, width: 32, height: 16 } })
  })

  it('reports a reference that scrolled past the viewport and one that is gone', () => {
    const element = tag()
    const anchorId = BacklogAnchorModel.idOf(element)
    place(element, -40)
    expect(BacklogAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'offscreen' })
    place(element, 920)
    expect(BacklogAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'offscreen' })
    element.remove()
    expect(BacklogAnchorModel.measure(anchorId, 900)).toEqual({ kind: 'gone' })
  })
})
