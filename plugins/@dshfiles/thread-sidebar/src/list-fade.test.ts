// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ListFade } from './list-fade.js'

const rect = (top: number, bottom: number): DOMRect => DOMRect.fromRect({ x: 0, y: top, width: 300, height: bottom - top })

const mount = (rowTop: number, rowBottom: number) => {
  const area = document.createElement('div')
  area.getBoundingClientRect = () => rect(0, 600)
  const row = document.createElement('article')
  row.dataset.threadId = 'session-1'
  row.getBoundingClientRect = () => rect(rowTop, rowBottom)
  area.append(row)
  document.body.append(area)
  return { area }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the thread list bottom fade (round nine B6)', () => {
  it('turns the fade off while the selected row reaches into it, without scrolling', () => {
    const { area } = mount(560, 590)
    area.scrollTop = 40
    ListFade.sync(area, 'session-1', 24)
    expect(area.hasAttribute('data-fade-off')).toBe(true)
    expect(area.scrollTop).toBe(40)
  })

  it('keeps the fade for a selected row above the fade zone or wholly below the scroller', () => {
    const above = mount(500, 560)
    ListFade.sync(above.area, 'session-1', 24)
    expect(above.area.hasAttribute('data-fade-off')).toBe(false)
    document.body.replaceChildren()
    const below = mount(700, 740)
    ListFade.sync(below.area, 'session-1', 24)
    expect(below.area.hasAttribute('data-fade-off')).toBe(false)
  })

  it('clears a stale switch when nothing is selected or the row is gone', () => {
    const { area } = mount(560, 590)
    ListFade.sync(area, 'session-1', 24)
    ListFade.sync(area, undefined, 24)
    expect(area.hasAttribute('data-fade-off')).toBe(false)
    ListFade.sync(area, 'session-1', 24)
    ListFade.sync(area, 'session-2', 24)
    expect(area.hasAttribute('data-fade-off')).toBe(false)
  })

  it('names the fade height the list draws: 24px, 14px under a coarse pointer', () => {
    expect(ListFade.height(false)).toBe(24)
    expect(ListFade.height(true)).toBe(14)
  })
})
