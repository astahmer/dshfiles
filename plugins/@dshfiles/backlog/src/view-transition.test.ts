import { describe, expect, it } from 'vitest'

import { itemTransitionName } from './view-transition.js'

describe('backlog item view-transition names', () => {
  it('keeps a row and a card apart, so switching views cross-fades instead of stretching one into the other', () => {
    expect(itemTransitionName('row', 7)).not.toBe(itemTransitionName('card', 7))
  })

  it('names an item the same inside its view, so it glides to its new spot', () => {
    expect(itemTransitionName('row', 7)).toBe('backlog-row-7')
    expect(itemTransitionName('card', 7)).toBe('backlog-card-7')
  })
})
