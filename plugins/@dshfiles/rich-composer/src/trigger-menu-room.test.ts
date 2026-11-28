import { describe, expect, it } from 'vitest'
import { MIN_ROOM_ABOVE, triggerMenuPlacement } from './trigger-menu-room.ts'

describe('the @ list with the keyboard up (DESIGN.md R12)', () => {
  it('stays above the composer, clamped under the top bar, while three rows fit there', () => {
    expect(triggerMenuPlacement({ anchorTop: 400, topBarBottom: 44, caretBottom: 430, keyboardTop: 844 })).toEqual({ mode: 'above', maxHeight: 344 })
  })

  it('opens under the caret, above the keyboard, on a sideways phone where it would start under the top bar', () => {
    // 844×390 with a 190px keyboard: 200px visible, the composer starts at 90.
    const placement = triggerMenuPlacement({ anchorTop: 90, topBarBottom: 44, caretBottom: 122, keyboardTop: 200 })
    expect(placement).toEqual({ mode: 'below', top: 36, maxHeight: 70 })
  })

  it('never reaches above the top bar', () => {
    const placement = triggerMenuPlacement({ anchorTop: 60, topBarBottom: 44, caretBottom: 190, keyboardTop: 196 })
    expect(placement.mode).toBe('above')
    expect(placement.maxHeight).toBeLessThan(MIN_ROOM_ABOVE)
    expect(placement.maxHeight).toBeGreaterThanOrEqual(0)
  })
})
