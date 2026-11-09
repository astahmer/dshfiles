import { describe, expect, it } from 'vitest'
import { shareRecord } from '../../src/native/client/sessions/share-record.ts'

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
})
