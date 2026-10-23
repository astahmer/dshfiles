import { describe, expect, it } from 'vitest'

import { backlogSelectionClick } from './use-backlog-selection.js'

const plain = { metaKey: false, ctrlKey: false, shiftKey: false }
const click = (input: Partial<Parameters<typeof backlogSelectionClick>[0]> = {}) =>
  backlogSelectionClick({
    state: { ids: new Set(), anchor: null },
    orderedIds: [1, 2, 3, 4],
    openId: null,
    id: 3,
    event: plain,
    ...input,
  })

describe('shared backlog list selection', () => {
  it.each(['metaKey', 'ctrlKey'] as const)('%s toggles with the visible open row seeded', modifier => {
    const event = { ...plain, [modifier]: true }
    const first = click({ openId: 1, event })
    expect([...first.ids]).toEqual([1, 3])
    expect([...click({ state: first, event }).ids]).toEqual([1])
  })

  it('never seeds an open row outside the visible scope', () => {
    expect([...click({ openId: 99, event: { ...plain, metaKey: true } }).ids]).toEqual([3])
  })

  it('extends inclusive ranges in visible order, including backwards', () => {
    const state = click({ id: 4 })
    expect([...click({ state, id: 2, event: { ...plain, shiftKey: true } }).ids]).toEqual([2, 3, 4])
  })

  it('uses the visible open row as the initial range anchor', () => {
    expect([...click({ openId: 1, event: { ...plain, shiftKey: true } }).ids]).toEqual([1, 2, 3])
  })

  it('clears selection on plain clicks while retaining the clicked anchor', () => {
    expect(click({ state: { ids: new Set([1, 2]), anchor: 1 } })).toEqual({ ids: new Set(), anchor: 3 })
  })

  it('drops hidden selections and anchors before the next gesture', () => {
    expect(click({ state: { ids: new Set([99, 2]), anchor: 99 }, event: { ...plain, shiftKey: true } })).toEqual({ ids: new Set([2, 3]), anchor: 3 })
  })
})
