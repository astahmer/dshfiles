import { describe, expect, it } from 'vitest'
import { SHEET_DRAG_CLOSE_RATIO, SHEET_DRAG_FLICK_PX_PER_MS, SheetDragModel } from './sheet-drag.js'

describe('SheetDragModel', () => {
  it('follows the finger down and never lifts the sheet above its rest', () => {
    expect(SheetDragModel.offset(40)).toBe(40)
    expect(SheetDragModel.offset(-40)).toBe(0)
  })

  it('closes past the share of its height, else springs back', () => {
    const height = 600
    expect(SheetDragModel.closes({ offset: height * SHEET_DRAG_CLOSE_RATIO, height, velocity: 0 })).toBe(true)
    expect(SheetDragModel.closes({ offset: height * SHEET_DRAG_CLOSE_RATIO - 1, height, velocity: 0 })).toBe(false)
    expect(SheetDragModel.closes({ offset: 0, height: 0, velocity: 0 })).toBe(false)
  })

  it('closes on a downward flick however short, and keeps the sheet on an upward one however long', () => {
    expect(SheetDragModel.closes({ offset: 20, height: 600, velocity: SHEET_DRAG_FLICK_PX_PER_MS + 0.01 })).toBe(true)
    expect(SheetDragModel.closes({ offset: 20, height: 600, velocity: SHEET_DRAG_FLICK_PX_PER_MS })).toBe(false)
    expect(SheetDragModel.closes({ offset: 500, height: 600, velocity: -SHEET_DRAG_FLICK_PX_PER_MS - 0.01 })).toBe(false)
  })

  it('measures velocity over the last 100 ms only', () => {
    expect(SheetDragModel.velocity([])).toBe(0)
    expect(SheetDragModel.velocity([{ y: 0, time: 0 }])).toBe(0)
    // A fast early pull, then a pause: the window sees only the pause.
    let samples = SheetDragModel.remember([], { y: 0, time: 0 })
    samples = SheetDragModel.remember(samples, { y: 300, time: 50 })
    samples = SheetDragModel.remember(samples, { y: 302, time: 400 })
    samples = SheetDragModel.remember(samples, { y: 304, time: 450 })
    expect(SheetDragModel.velocity(samples)).toBeCloseTo(2 / 50)
    expect(SheetDragModel.velocity(SheetDragModel.remember([{ y: 0, time: 0 }], { y: 80, time: 80 }))).toBe(1)
  })
})
