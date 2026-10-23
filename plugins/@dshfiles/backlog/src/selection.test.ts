import { describe, expect, it } from 'vitest'

import { BacklogSelection } from './selection.js'

describe('backlog selection', () => {
  it('toggles non-adjacent items without changing the remaining selection', () => {
    expect(BacklogSelection.toggle(new Set([1, 3]), 2)).toEqual(new Set([1, 2, 3]))
    expect(BacklogSelection.toggle(new Set([1, 2, 3]), 2)).toEqual(new Set([1, 3]))
  })

  it('adds the inclusive range in either direction and preserves additive selections', () => {
    expect(BacklogSelection.extend(new Set([8]), [1, 2, 3, 4, 5], 2, 4)).toEqual(new Set([2, 3, 4, 8]))
    expect(BacklogSelection.extend(new Set(), [1, 2, 3, 4, 5], 4, 2)).toEqual(new Set([2, 3, 4]))
  })

  it('selects the target if the anchor is no longer in the visible order', () => {
    expect(BacklogSelection.extend(new Set([8]), [1, 2, 3], 7, 2)).toEqual(new Set([2]))
  })

  it('starts a modifier selection from the open item only when nothing is selected', () => {
    expect(BacklogSelection.toggle(BacklogSelection.seed(new Set(), 264), 265)).toEqual(new Set([264, 265]))
    expect(BacklogSelection.toggle(BacklogSelection.seed(new Set(), 264), 264)).toEqual(new Set())
    expect(BacklogSelection.seed(new Set([3]), 264)).toEqual(new Set([3]))
    expect(BacklogSelection.seed(new Set(), null)).toEqual(new Set())
  })
})
