import { describe, expect, it } from 'vitest'
import { DRAWER_MAX_WIDTH_PX, DrawerGestureModel } from './drawer-gesture.js'

describe('DrawerGestureModel', () => {
  it('covers 85% of a phone, at most 360px', () => {
    expect(DrawerGestureModel.width(390)).toBe(332)
    expect(DrawerGestureModel.width(1024)).toBe(DRAWER_MAX_WIDTH_PX)
  })

  it('opens from anywhere on the stage, not only the edge band Android gesture navigation takes', () => {
    expect(DrawerGestureModel.openingOrigin({ x: 10, width: 390 })).toBe('edge')
    expect(DrawerGestureModel.openingOrigin({ x: 120, width: 390 })).toBe('stage')
    expect(DrawerGestureModel.openingOrigin({ x: 380, width: 390 })).toBe('stage')
    expect(DrawerGestureModel.openingOrigin({ x: -1, width: 390 })).toBeNull()
  })

  it('follows the finger from closed and from open, clamped to the drawer', () => {
    expect(DrawerGestureModel.progress({ startedOpen: false, dx: 166, width: 332 })).toBe(0.5)
    expect(DrawerGestureModel.progress({ startedOpen: false, dx: -40, width: 332 })).toBe(0)
    expect(DrawerGestureModel.progress({ startedOpen: false, dx: 500, width: 332 })).toBe(1)
    expect(DrawerGestureModel.progress({ startedOpen: true, dx: -83, width: 332 })).toBe(0.75)
    expect(DrawerGestureModel.progress({ startedOpen: true, dx: 60, width: 332 })).toBe(1)
  })

  it('locks opening to a rightward swipe and closing to a leftward one; vertical travel scrolls', () => {
    expect(DrawerGestureModel.intent({ startedOpen: false, current: 'undecided', dx: 4, dy: 2 })).toBe('undecided')
    expect(DrawerGestureModel.intent({ startedOpen: false, current: 'undecided', dx: 30, dy: 5 })).toBe('swipe')
    expect(DrawerGestureModel.intent({ startedOpen: false, current: 'undecided', dx: -30, dy: 5 })).toBe('other')
    expect(DrawerGestureModel.intent({ startedOpen: false, current: 'undecided', dx: 12, dy: 30 })).toBe('other')
    expect(DrawerGestureModel.intent({ startedOpen: true, current: 'undecided', dx: -30, dy: 5 })).toBe('swipe')
    expect(DrawerGestureModel.intent({ startedOpen: true, current: 'undecided', dx: 30, dy: 5 })).toBe('other')
    // Once locked, the intent holds for the rest of the gesture.
    expect(DrawerGestureModel.intent({ startedOpen: true, current: 'swipe', dx: 30, dy: 200 })).toBe('swipe')
  })

  it('measures velocity over the last 100ms only', () => {
    expect(DrawerGestureModel.velocity([])).toBe(0)
    expect(DrawerGestureModel.velocity([{ x: 10, t: 0 }])).toBe(0)
    expect(
      DrawerGestureModel.velocity([
        { x: 0, t: 0 },
        { x: 100, t: 400 },
        { x: 150, t: 450 },
        { x: 200, t: 500 },
      ]),
    ).toBe(1)
    // A finger that stopped before lifting reads as still.
    expect(
      DrawerGestureModel.velocity([
        { x: 0, t: 0 },
        { x: 200, t: 100 },
        { x: 200, t: 400 },
      ]),
    ).toBe(0)
  })

  it('snaps by distance, unless a flick says otherwise', () => {
    expect(DrawerGestureModel.settlesOpen({ progress: 0.6, velocity: 0 })).toBe(true)
    expect(DrawerGestureModel.settlesOpen({ progress: 0.4, velocity: 0.1 })).toBe(false)
    expect(DrawerGestureModel.settlesOpen({ progress: 0.2, velocity: 0.8 })).toBe(true)
    expect(DrawerGestureModel.settlesOpen({ progress: 0.9, velocity: -0.6 })).toBe(false)
  })
})
