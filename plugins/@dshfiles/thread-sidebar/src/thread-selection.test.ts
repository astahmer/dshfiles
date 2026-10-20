// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadSelectionModel } from './thread-selection.js'

const ids = ['a', 'b', 'c', 'd', 'e'] as const

afterEach(() => document.body.replaceChildren())

describe('thread selection model', () => {
  it('selects one row and records it as the range anchor', () => {
    expect(ThreadSelectionModel.selectOnly('c')).toEqual({ sessionIds: ['c'], anchorId: 'c' })
  })

  it('toggles non-adjacent rows without duplicates and moves the anchor to the clicked row', () => {
    const first = ThreadSelectionModel.toggle(ThreadSelectionModel.selectOnly('a'), 'c')
    expect(first).toEqual({ sessionIds: ['a', 'c'], anchorId: 'c' })

    const toggledOff = ThreadSelectionModel.toggle(first, 'a')
    expect(toggledOff).toEqual({ sessionIds: ['c'], anchorId: 'a' })
  })

  it('extends a range in both directions from the anchor, inclusive', () => {
    const state = { sessionIds: ['b', 'c'], anchorId: 'b' }
    expect(ThreadSelectionModel.extend({ state, orderedIds: ids, sessionId: 'e', fallbackAnchorId: undefined })).toEqual({
      sessionIds: ['b', 'c', 'd', 'e'],
      anchorId: 'b',
    })
    expect(ThreadSelectionModel.extend({ state, orderedIds: ids, sessionId: 'a', fallbackAnchorId: undefined })).toEqual({
      sessionIds: ['a', 'b'],
      anchorId: 'b',
    })
  })

  it('uses the focused row as the anchor when no range is active, and falls back to a single row for an unknown anchor', () => {
    expect(
      ThreadSelectionModel.extend({
        state: ThreadSelectionModel.empty(),
        orderedIds: ids,
        sessionId: 'd',
        fallbackAnchorId: 'b',
      }),
    ).toEqual({ sessionIds: ['b', 'c', 'd'], anchorId: 'b' })
    expect(
      ThreadSelectionModel.extend({
        state: { sessionIds: ['gone'], anchorId: 'gone' },
        orderedIds: ids,
        sessionId: 'd',
        fallbackAnchorId: 'b',
      }),
    ).toEqual({ sessionIds: ['d'], anchorId: 'd' })
  })

  it('selects all visible rows once, anchored at the first row', () => {
    expect(ThreadSelectionModel.selectAll(ids)).toEqual({ sessionIds: [...ids], anchorId: 'a' })
    expect(ThreadSelectionModel.selectAll(['a', 'a', 'b'])).toEqual({ sessionIds: ['a', 'b'], anchorId: 'a' })
    expect(ThreadSelectionModel.selectAll([])).toEqual({ sessionIds: [], anchorId: undefined })
  })

  it('paints and unpaints only the rows currently selected', () => {
    const list = document.createElement('div')
    const buttons = ['a', 'b', 'c'].map(sessionId => {
      const button = document.createElement('button')
      button.dataset.threadId = sessionId
      button.dataset.threadMainAction = ''
      list.append(button)
      return button
    })
    document.body.append(list)

    ThreadSelectionModel.applyToDom({ list, sessionIds: ['a', 'c'] })
    expect(buttons.map(button => button.dataset.multiSelected)).toEqual(['true', undefined, 'true'])

    ThreadSelectionModel.applyToDom({ list, sessionIds: ['b'] })
    expect(buttons.map(button => button.dataset.multiSelected)).toEqual([undefined, 'true', undefined])
  })
})
