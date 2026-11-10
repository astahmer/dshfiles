import { describe, expect, it } from 'vitest'
import { noRowAction, rowActionReducer } from './row-action.js'

describe('rowActionReducer', () => {
  it('opens a dismiss form with an empty reason', () => {
    expect(rowActionReducer(noRowAction, { type: 'dismiss', id: 'a1' })).toEqual({ kind: 'dismissing', id: 'a1', reason: '' })
  })

  it('keeps one row action at a time, so a second row replaces the first', () => {
    const dismissing = rowActionReducer(noRowAction, { type: 'dismiss', id: 'a1' })
    const replying = rowActionReducer(dismissing, { type: 'reply', id: 'a2' })
    expect(replying).toEqual({ kind: 'replying', id: 'a2', body: '' })
  })

  it('edits the reason of the dismissing row only', () => {
    const dismissing = rowActionReducer(noRowAction, { type: 'dismiss', id: 'a1' })
    const edited = rowActionReducer(dismissing, { type: 'reason', reason: 'changed in the new build' })
    expect(edited).toEqual({ kind: 'dismissing', id: 'a1', reason: 'changed in the new build' })
    expect(rowActionReducer(edited, { type: 'body', body: 'ignored' })).toBe(edited)
  })

  it('edits the reply of the replying row only', () => {
    const replying = rowActionReducer(noRowAction, { type: 'reply', id: 'a1' })
    const edited = rowActionReducer(replying, { type: 'body', body: 'on it' })
    expect(edited).toEqual({ kind: 'replying', id: 'a1', body: 'on it' })
    expect(rowActionReducer(edited, { type: 'reason', reason: 'ignored' })).toBe(edited)
  })

  it('clears the row action once the Host accepts it', () => {
    const replying = rowActionReducer(noRowAction, { type: 'reply', id: 'a1' })
    expect(rowActionReducer(replying, { type: 'settled' })).toBe(noRowAction)
  })
})
