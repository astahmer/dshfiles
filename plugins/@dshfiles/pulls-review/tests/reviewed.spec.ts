import { describe, expect, it } from 'vitest'
import { MAX_REVIEWED_KEYS, recordReviewed, reviewedKeyOf, toggleReviewed } from '../src/reviewed.js'

describe('reviewed marks', () => {
  it('separates the same path across workspaces, bases and revisions', () => {
    expect(reviewedKeyOf('/work/a', 'main', 'abc1234')).not.toBe(reviewedKeyOf('/work/b', 'main', 'abc1234'))
    expect(reviewedKeyOf('/work/a', 'main', 'abc1234')).not.toBe(reviewedKeyOf('/work/a', 'release', 'abc1234'))
    expect(reviewedKeyOf('/work/a', 'main', 'abc1234')).not.toBe(reviewedKeyOf('/work/a', 'main', 'def5678'))
    expect(reviewedKeyOf('/work/a', 'main', 'abc1234')).toBe(reviewedKeyOf('/work/a', 'main', 'abc1234'))
  })

  it('toggles one path without touching the others', () => {
    expect(toggleReviewed([], 'a.ts')).toEqual(['a.ts'])
    expect(toggleReviewed(['a.ts', 'b.ts'], 'a.ts')).toEqual(['b.ts'])
    expect(toggleReviewed(['a.ts'], 'a.ts')).toEqual([])
    expect(toggleReviewed(['b.ts'], 'a.ts')).toEqual(['b.ts', 'a.ts'])
  })

  it('keeps the record bounded and evicts the least recently touched key', () => {
    let record: Record<string, string[]> = {}
    for (let index = 0; index < MAX_REVIEWED_KEYS + 3; index++) record = recordReviewed(record, `key-${index}`, ['a.ts'])
    const keys = Object.keys(record)
    expect(keys).toHaveLength(MAX_REVIEWED_KEYS)
    expect(keys).not.toContain('key-0')
    expect(keys.at(-1)).toBe(`key-${MAX_REVIEWED_KEYS + 2}`)
  })

  it('moves a touched key to the end so it is not the next eviction', () => {
    let record: Record<string, string[]> = {}
    for (let index = 0; index < MAX_REVIEWED_KEYS; index++) record = recordReviewed(record, `key-${index}`, ['a.ts'])
    record = recordReviewed(record, 'key-0', ['b.ts'])
    record = recordReviewed(record, 'key-new', ['a.ts'])
    expect(Object.keys(record)).toContain('key-0')
    expect(Object.keys(record)).not.toContain('key-1')
    expect(record['key-0']).toEqual(['b.ts'])
  })
})
