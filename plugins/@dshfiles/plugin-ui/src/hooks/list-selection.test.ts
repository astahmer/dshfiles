import { describe, expect, it } from 'vitest'

import { ListSelectionModel } from './list-selection.js'

const ids = ['a', 'b', 'c', 'd', 'e'] as const

describe('list selection', () => {
  it('selects one row and remembers it as the range anchor', () => {
    expect(ListSelectionModel.selectOnly({ id: 'c' })).toEqual({ ids: ['c'], anchorId: 'c' })
  })

  it('toggles non-adjacent rows without duplicates and moves the anchor to the toggled row', () => {
    const first = ListSelectionModel.toggle({ state: ListSelectionModel.selectOnly({ id: 'a' }), id: 'c' })
    expect(first).toEqual({ ids: ['a', 'c'], anchorId: 'c' })
    expect(ListSelectionModel.toggle({ state: first, id: 'a' })).toEqual({ ids: ['c'], anchorId: 'a' })
  })

  it('extends an inclusive range in either direction from the anchor', () => {
    const state = { ids: ['b'], anchorId: 'b' }
    expect(ListSelectionModel.extend({ state, orderedIds: ids, id: 'd' })).toEqual({ ids: ['b', 'c', 'd'], anchorId: 'b' })
    expect(ListSelectionModel.extend({ state: { ids: ['d'], anchorId: 'd' }, orderedIds: ids, id: 'b' })).toEqual({
      ids: ['b', 'c', 'd'],
      anchorId: 'd',
    })
  })

  it('falls back to a single row when the anchor is gone and keeps the state when the target is unknown', () => {
    expect(ListSelectionModel.extend({ state: { ids: ['gone'], anchorId: 'gone' }, orderedIds: ids, id: 'd' })).toEqual({
      ids: ['d'],
      anchorId: 'd',
    })
    expect(ListSelectionModel.extend({ state: ListSelectionModel.selectOnly({ id: 'b' }), orderedIds: ids, id: 'gone' })).toEqual({
      ids: ['b'],
      anchorId: 'b',
    })
  })

  it('selects every visible row once, anchored at the first, and toggles that off', () => {
    expect(ListSelectionModel.selectAllVisible({ orderedIds: ['a', 'a', 'b'] })).toEqual({ ids: ['a', 'b'], anchorId: 'a' })
    expect(ListSelectionModel.selectAllVisible({ orderedIds: [] })).toEqual({ ids: [], anchorId: undefined })
    expect(ListSelectionModel.isComplete({ state: { ids: ['a', 'b'], anchorId: 'a' }, orderedIds: ['a', 'b'] })).toBe(true)
    expect(ListSelectionModel.isComplete({ state: { ids: ['a'], anchorId: 'a' }, orderedIds: ['a', 'b'] })).toBe(false)
    expect(ListSelectionModel.toggleAllVisible({ state: { ids: ['a', 'b'], anchorId: 'a' }, orderedIds: ['a', 'b'] })).toEqual({
      ids: [],
      anchorId: undefined,
    })
  })

  it('drops ids that are no longer visible and forgets an invisible anchor', () => {
    expect(ListSelectionModel.prune({ state: { ids: ['a', 'c', 'e'], anchorId: 'c' }, visibleIds: ['a', 'b', 'c'] })).toEqual({
      ids: ['a', 'c'],
      anchorId: 'c',
    })
    expect(ListSelectionModel.prune({ state: { ids: ['a'], anchorId: 'a' }, visibleIds: ['b'] })).toEqual(ListSelectionModel.empty())
  })
})
