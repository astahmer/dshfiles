import { describe, expect, it } from 'vitest'

import { extendBacklogSelection, toggleBacklogSelection } from './selection.js'

describe('backlog selection', () => {
  it('toggles non-adjacent items without changing the remaining selection', () => {
    expect(toggleBacklogSelection(new Set([1, 3]), 2)).toEqual(new Set([1, 2, 3]))
    expect(toggleBacklogSelection(new Set([1, 2, 3]), 2)).toEqual(new Set([1, 3]))
  })

  it('adds the inclusive range in either direction and preserves additive selections', () => {
    expect(extendBacklogSelection(new Set([8]), [1, 2, 3, 4, 5], 2, 4)).toEqual(new Set([2, 3, 4, 8]))
    expect(extendBacklogSelection(new Set(), [1, 2, 3, 4, 5], 4, 2)).toEqual(new Set([2, 3, 4]))
  })

  it('selects the target if the anchor is no longer in the visible order', () => {
    expect(extendBacklogSelection(new Set([8]), [1, 2, 3], 7, 2)).toEqual(new Set([2]))
  })
})
