import { describe, expect, it } from 'vitest'
import { evictableIndex, IDLE_INDEX_MS } from './index-eviction.js'

describe('resident index eviction', () => {
  it('drops an index nobody used for the idle window', () => {
    expect(evictableIndex({ lastUsedAt: 0, inUse: 0 }, IDLE_INDEX_MS)).toBe(true)
  })

  it('keeps an index that was used within the idle window', () => {
    expect(evictableIndex({ lastUsedAt: 1_000, inUse: 0 }, IDLE_INDEX_MS)).toBe(false)
  })

  it('never destroys an index a query is still reading', () => {
    expect(evictableIndex({ lastUsedAt: 0, inUse: 1 }, IDLE_INDEX_MS * 10)).toBe(false)
  })
})
