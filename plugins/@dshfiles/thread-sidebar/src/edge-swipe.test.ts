import { describe, expect, it } from 'vitest'
import { EDGE_SWIPE_BAND_PX, EDGE_SWIPE_COMMIT_PX, EdgeSwipeModel } from './edge-swipe.js'

describe('EdgeSwipeModel', () => {
  it('starts only inside the left edge band, widened by the safe area', () => {
    expect(EdgeSwipeModel.starts(0)).toBe(true)
    expect(EdgeSwipeModel.starts(EDGE_SWIPE_BAND_PX)).toBe(true)
    expect(EdgeSwipeModel.starts(EDGE_SWIPE_BAND_PX + 1)).toBe(false)
    expect(EdgeSwipeModel.starts(EDGE_SWIPE_BAND_PX + 20, 30)).toBe(true)
  })

  it('locks to a back swipe only when the finger travels right and mostly sideways', () => {
    expect(EdgeSwipeModel.intent('undecided', 5, 4)).toBe('undecided')
    expect(EdgeSwipeModel.intent('undecided', 30, 8)).toBe('back')
    // A vertical scroll that starts on the edge stays a scroll.
    expect(EdgeSwipeModel.intent('undecided', 12, 30)).toBe('other')
    // Leftward is never Back.
    expect(EdgeSwipeModel.intent('undecided', -30, 0)).toBe('other')
    expect(EdgeSwipeModel.intent('other', 200, 0)).toBe('other')
  })

  it('commits only a back swipe released past the threshold', () => {
    expect(EdgeSwipeModel.commits('back', EDGE_SWIPE_COMMIT_PX)).toBe(true)
    expect(EdgeSwipeModel.commits('back', EDGE_SWIPE_COMMIT_PX - 1)).toBe(false)
    expect(EdgeSwipeModel.commits('other', 300)).toBe(false)
    expect(EdgeSwipeModel.commits('undecided', 300)).toBe(false)
  })
})
