import { describe, expect, it } from 'vitest'
import { reviewedKeyOf, toggleReviewed } from '../src/reviewed.js'

describe('reviewed marks', () => {
  it('separates the same path across workspaces and revisions', () => {
    expect(reviewedKeyOf('/work/a', 'abc1234')).not.toBe(reviewedKeyOf('/work/b', 'abc1234'))
    expect(reviewedKeyOf('/work/a', 'abc1234')).not.toBe(reviewedKeyOf('/work/a', 'def5678'))
    expect(reviewedKeyOf('/work/a', 'abc1234')).toBe(reviewedKeyOf('/work/a', 'abc1234'))
  })

  it('toggles one path without touching the others', () => {
    expect(toggleReviewed([], 'a.ts')).toEqual(['a.ts'])
    expect(toggleReviewed(['a.ts', 'b.ts'], 'a.ts')).toEqual(['b.ts'])
    expect(toggleReviewed(['a.ts'], 'a.ts')).toEqual([])
    expect(toggleReviewed(['b.ts'], 'a.ts')).toEqual(['b.ts', 'a.ts'])
  })
})
