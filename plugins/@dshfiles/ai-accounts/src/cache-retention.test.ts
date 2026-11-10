import { describe, expect, it } from 'vitest'
import { cacheRetentionFor } from './cache-retention.js'

describe('per-route prompt cache retention', () => {
  it('selects an exact model before a route wildcard and leaves the default unchanged', () => {
    const settings = { 'work/*': 'long', 'work/claude-small': 'short' } as const
    expect(cacheRetentionFor({ provider: 'work', model: 'claude-small', settings })).toBe('short')
    expect(cacheRetentionFor({ provider: 'work', model: 'claude-large', settings })).toBe('long')
    expect(cacheRetentionFor({ provider: 'other', model: 'claude-large', settings })).toBeUndefined()
  })
})
