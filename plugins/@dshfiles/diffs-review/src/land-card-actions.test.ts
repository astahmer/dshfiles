import { describe, expect, it } from 'vitest'
import { arrangeLandCardActions, type LandCardAction } from './land-card-actions.js'

const action = (id: string, order?: number): LandCardAction => (order === undefined ? { id, component: () => null } : { id, order, component: () => null })

describe('Land card actions', () => {
  it('keeps the first action per id and sorts by order, then registration', () => {
    expect(arrangeLandCardActions([action('b', 10), action('a'), action('b', 0), action('c', 10)]).map(entry => entry.id)).toEqual(['a', 'b', 'c'])
  })
})
