import { describe, expect, it } from 'vitest'
import { sameThreadRows, type ThreadRow } from './thread-projection.js'

const rows: readonly ThreadRow[] = [
  { id: 'session-1', displayTitle: 'Ship it', cwd: '/repo/one', updatedAt: 2 },
  { id: 'session-2', displayTitle: 'Review it', cwd: undefined, updatedAt: 1 },
]

describe('toolkit thread projection equality', () => {
  it('accepts the same rows in the same order', () => {
    expect(sameThreadRows(rows, rows.map(row => ({ ...row })))).toBe(true)
    expect(sameThreadRows([], [])).toBe(true)
  })

  it('rejects a changed title, path, order or timestamp', () => {
    expect(sameThreadRows(rows, [{ ...rows[0]!, displayTitle: 'Shipped' }, rows[1]!])).toBe(false)
    expect(sameThreadRows(rows, [rows[0]!, { ...rows[1]!, cwd: '/repo/two' }])).toBe(false)
    expect(sameThreadRows(rows, [...rows].reverse())).toBe(false)
    expect(sameThreadRows(rows, [rows[0]!, { ...rows[1]!, updatedAt: 3 }])).toBe(false)
  })

  it('rejects a row replaced by a different thread, and a changed length', () => {
    expect(sameThreadRows(rows, [{ ...rows[0]!, id: 'session-9' }, rows[1]!])).toBe(false)
    expect(sameThreadRows(rows, rows.slice(0, 1))).toBe(false)
    expect(sameThreadRows(rows.slice(0, 1), rows)).toBe(false)
  })
})
