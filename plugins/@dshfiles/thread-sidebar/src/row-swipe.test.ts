import { describe, expect, it } from 'vitest'
import { ROW_SWIPE_COMMIT_PX } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { RowSwipeModel } from './row-swipe.js'

describe('RowSwipeModel', () => {
  it('locks the gesture to the axis it leaves the tap slop on', () => {
    expect(RowSwipeModel.intent('undecided', 4, 3)).toBe('undecided')
    expect(RowSwipeModel.intent('undecided', 20, 5)).toBe('horizontal')
    expect(RowSwipeModel.intent('undecided', 6, 18)).toBe('vertical')
    // Once vertical, a later sideways movement never turns the scroll into a swipe.
    expect(RowSwipeModel.intent('vertical', 200, 0)).toBe('vertical')
  })

  it('commits Done to the left and Pin to the right only past the threshold', () => {
    expect(RowSwipeModel.action(-ROW_SWIPE_COMMIT_PX)).toBe('done')
    expect(RowSwipeModel.action(ROW_SWIPE_COMMIT_PX + 30)).toBe('pin')
    expect(RowSwipeModel.action(ROW_SWIPE_COMMIT_PX - 1)).toBeUndefined()
    expect(RowSwipeModel.action(-20)).toBeUndefined()
    expect(RowSwipeModel.revealed(-5)).toBe('done')
    expect(RowSwipeModel.revealed(5)).toBe('pin')
    expect(RowSwipeModel.revealed(0)).toBeUndefined()
  })

  it('follows the finger, then eases and caps the travel', () => {
    expect(RowSwipeModel.offset(40)).toBe(40)
    expect(RowSwipeModel.offset(-ROW_SWIPE_COMMIT_PX)).toBe(-ROW_SWIPE_COMMIT_PX)
    expect(RowSwipeModel.offset(ROW_SWIPE_COMMIT_PX + 30)).toBe(ROW_SWIPE_COMMIT_PX + 10)
    expect(RowSwipeModel.offset(-1000)).toBe(-96)
  })
})
