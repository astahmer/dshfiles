import { describe, expect, it } from 'vitest'
import { EDGE_SWIPE_BAND_PX, EDGE_SWIPE_COMMIT_PX, EDGE_SWIPE_RIGHT_INSET_PX, EdgeSwipeModel } from './edge-swipe.js'

const width = 390

describe('EdgeSwipeModel', () => {
  it('starts only inside the left edge band, widened by the safe area', () => {
    expect(EdgeSwipeModel.starts({ side: 'left', x: 0, width })).toBe(true)
    expect(EdgeSwipeModel.starts({ side: 'left', x: EDGE_SWIPE_BAND_PX, width })).toBe(true)
    expect(EdgeSwipeModel.starts({ side: 'left', x: EDGE_SWIPE_BAND_PX + 1, width })).toBe(false)
    expect(EdgeSwipeModel.starts({ side: 'left', x: EDGE_SWIPE_BAND_PX + 20, width, inset: 30 })).toBe(true)
  })

  it('starts the right swipe only in a band slightly inside the right edge, past the system back strip', () => {
    const outer = width - EDGE_SWIPE_RIGHT_INSET_PX
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer, width })).toBe(true)
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer - EDGE_SWIPE_BAND_PX, width })).toBe(true)
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer - EDGE_SWIPE_BAND_PX - 1, width })).toBe(false)
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer + 1, width })).toBe(false)
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer - 10, width, inset: 20 })).toBe(false)
    expect(EdgeSwipeModel.starts({ side: 'right', x: outer - 30, width, inset: 20 })).toBe(true)
  })

  it('locks to a swipe only when the finger travels away from its edge and mostly sideways', () => {
    expect(EdgeSwipeModel.intent({ side: 'left', current: 'undecided', dx: 5, dy: 4 })).toBe('undecided')
    expect(EdgeSwipeModel.intent({ side: 'left', current: 'undecided', dx: 30, dy: 8 })).toBe('swipe')
    // A vertical scroll that starts on the edge stays a scroll.
    expect(EdgeSwipeModel.intent({ side: 'left', current: 'undecided', dx: 12, dy: 30 })).toBe('other')
    // Toward the edge is never a swipe.
    expect(EdgeSwipeModel.intent({ side: 'left', current: 'undecided', dx: -30, dy: 0 })).toBe('other')
    expect(EdgeSwipeModel.intent({ side: 'left', current: 'other', dx: 200, dy: 0 })).toBe('other')
    expect(EdgeSwipeModel.intent({ side: 'right', current: 'undecided', dx: -30, dy: 8 })).toBe('swipe')
    expect(EdgeSwipeModel.intent({ side: 'right', current: 'undecided', dx: 30, dy: 0 })).toBe('other')
    // 1.5x sideways: 15 across for 10 down is the limit.
    expect(EdgeSwipeModel.intent({ side: 'right', current: 'undecided', dx: -15, dy: 10 })).toBe('other')
    expect(EdgeSwipeModel.intent({ side: 'right', current: 'undecided', dx: -16, dy: 10 })).toBe('swipe')
  })

  it('commits only a swipe released past the threshold, away from its edge', () => {
    expect(EdgeSwipeModel.commits({ side: 'left', intent: 'swipe', dx: EDGE_SWIPE_COMMIT_PX })).toBe(true)
    expect(EdgeSwipeModel.commits({ side: 'left', intent: 'swipe', dx: EDGE_SWIPE_COMMIT_PX - 1 })).toBe(false)
    expect(EdgeSwipeModel.commits({ side: 'left', intent: 'other', dx: 300 })).toBe(false)
    expect(EdgeSwipeModel.commits({ side: 'left', intent: 'undecided', dx: 300 })).toBe(false)
    expect(EdgeSwipeModel.commits({ side: 'right', intent: 'swipe', dx: -EDGE_SWIPE_COMMIT_PX })).toBe(true)
    expect(EdgeSwipeModel.commits({ side: 'right', intent: 'swipe', dx: EDGE_SWIPE_COMMIT_PX })).toBe(false)
  })

  it('leaves a sideways drag to any horizontally scrollable element, even one scrolled to its start', () => {
    expect(EdgeSwipeModel.scrollsSideways({ scrollWidth: 800, clientWidth: 390, overflowX: 'auto' })).toBe(true)
    expect(EdgeSwipeModel.scrollsSideways({ scrollWidth: 800, clientWidth: 390, overflowX: 'scroll' })).toBe(true)
    expect(EdgeSwipeModel.scrollsSideways({ scrollWidth: 800, clientWidth: 390, overflowX: 'hidden' })).toBe(false)
    expect(EdgeSwipeModel.scrollsSideways({ scrollWidth: 390, clientWidth: 390, overflowX: 'auto' })).toBe(false)
  })
})
