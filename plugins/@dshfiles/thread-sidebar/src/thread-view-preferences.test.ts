import { describe, expect, it } from 'vitest'
import { decodeThreadViewPreferences } from './thread-view-preferences.js'

describe('thread view preferences', () => {
  it('defaults newly added view options for older saved values', () => {
    expect(decodeThreadViewPreferences({ groupBy: 'date' })).toEqual({
      groupBy: 'date',
      statusFilter: 'all',
      sourceFilter: 'all',
    })
  })

  it('rejects unknown options and malformed stored values', () => {
    expect(decodeThreadViewPreferences({ groupBy: 'model' })).toBeNull()
    expect(decodeThreadViewPreferences({ groupBy: 'date', unexpected: true })).toBeNull()
  })
})
