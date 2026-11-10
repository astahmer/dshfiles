import { describe, expect, it } from 'vitest'
import { shareListSnapshot, shareRecord } from '../../src/native/client/sessions/share-record.ts'

// The list projection rebuilds every row per manager flush; publishing those copies re-rendered every
// list consumer (sidebar, workbench panels, selectors) on each streamed event of any running thread.
describe('shareRecord', () => {
  const retainedBy = Object.freeze({})
  interface Row {
    id: string
    displayTitle: string
    running: boolean
    retainedBy: object
    updatedAt: number
    title?: string
  }
  const row = (id: string, running: boolean): Row => ({ id, displayTitle: id, running, retainedBy, updatedAt: 1 })

  it('returns the previous record when a rebuild changed nothing', () => {
    const previous = { a: row('a', false), b: row('b', true) }
    expect(shareRecord(previous, { a: row('a', false), b: row('b', true) })).toBe(previous)
  })

  it('keeps unchanged rows identical and publishes only the changed one', () => {
    const previous = { a: row('a', false), b: row('b', true) }
    const next = shareRecord(previous, { a: row('a', false), b: row('b', false) })
    expect(next).not.toBe(previous)
    expect(next.a).toBe(previous.a)
    expect(next.b).not.toBe(previous.b)
    expect(next.b?.running).toBe(false)
  })

  it('treats an added, removed or newly keyed field as a change', () => {
    const previous = { a: row('a', false) }
    expect(shareRecord<string, Row>(previous, {})).not.toBe(previous)
    expect(shareRecord<string, Row>(previous, { a: row('a', false), b: row('b', false) })).not.toBe(previous)
    const withTitle = shareRecord(previous, { a: { ...row('a', false), title: 'named' } })
    expect(withTitle.a).not.toBe(previous.a)
  })

  it('publishes a row whose retention snapshot was replaced', () => {
    // Retention counts are replaced by a new frozen object on every change, never mutated in place.
    const previous = { a: row('a', false) }
    const next = shareRecord(previous, { a: { ...row('a', false), retainedBy: Object.freeze({ sidebar: 1 }) } })
    expect(next.a).not.toBe(previous.a)
  })

  it('never modifies its arguments', () => {
    const previous = { a: row('a', false) }
    const fresh = { a: row('a', false), b: row('b', false) }
    const freshA = fresh.a
    const next = shareRecord<string, Row>(previous, fresh)
    expect(fresh.a).toBe(freshA)
    expect(next.a).toBe(previous.a)
  })
})

describe('shareListSnapshot', () => {
  const retainedBy = Object.freeze({})
  const snapshot = (running: boolean) => ({
    ids: ['a', 'b'],
    byId: { a: { id: 'a', running, retainedBy }, b: { id: 'b', running: false, retainedBy } },
    phase: 'ready',
    projectionsBySession: { a: { values: retainedBy } },
  })

  it('returns the previous snapshot when the rebuild changed nothing', () => {
    const previous = snapshot(false)
    expect(shareListSnapshot(previous, snapshot(false))).toBe(previous)
  })

  it('shares unchanged parts and publishes the changed row', () => {
    const previous = snapshot(false)
    const next = shareListSnapshot(previous, snapshot(true))
    expect(next).not.toBe(previous)
    expect(next.ids).toBe(previous.ids)
    expect(next.byId.b).toBe(previous.byId.b)
    expect(next.byId.a.running).toBe(true)
    expect(next.projectionsBySession).toBe(previous.projectionsBySession)
  })

  it('treats a reorder or a phase change as a change', () => {
    const previous = snapshot(false)
    const reordered = shareListSnapshot(previous, { ...snapshot(false), ids: ['b', 'a'] })
    expect(reordered.ids).toEqual(['b', 'a'])
    expect(shareListSnapshot(previous, { ...snapshot(false), phase: 'loading' }).phase).toBe('loading')
  })
})
