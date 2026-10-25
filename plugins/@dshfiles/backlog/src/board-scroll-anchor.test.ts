import { describe, expect, it } from 'vitest'

import { BoardScrollAnchors } from './board-scroll-anchor.js'

describe('boardScrollTopForAnchor', () => {
  it('keeps the same card at the same viewport position when updates reorder a column', () => {
    expect(BoardScrollAnchors.scrollTopForAnchor({ scrollTop: 840, top: 190 }, 70)).toBe(720)
  })

  it('keeps the same scroll position when an update does not move the anchor card', () => {
    expect(BoardScrollAnchors.scrollTopForAnchor({ scrollTop: 840, top: 190 }, 190)).toBe(840)
  })
})
