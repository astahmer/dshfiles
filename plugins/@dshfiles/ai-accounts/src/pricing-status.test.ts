import { describe, expect, it } from 'vitest'
import { fetchedAgo, pricingStatusLine } from './pricing-status.js'

const pricing = { fetchedAt: 1_760_000_000_000, source: 'https://models.dev/api.json', modelCount: 412, refreshing: false, lastError: null }
const threeHours = { unit: 'hours', n: 3 } as const

describe('price catalog status', () => {
  it('names the source and how long ago the catalog was fetched', () => {
    expect(pricingStatusLine({ pricing, fetchedAge: threeHours })).toBe('412 models priced from models.dev, fetched 3h ago')
  })

  it('keeps the last refresh failure next to the cached catalog', () => {
    expect(pricingStatusLine({ pricing: { ...pricing, lastError: 'HTTP 503' }, fetchedAge: threeHours })).toBe(
      '412 models priced from models.dev, fetched 3h ago · last refresh failed: HTTP 503',
    )
  })

  it('reads a fresh fetch as just now', () => {
    expect(fetchedAgo({ unit: 'now', n: 0 })).toBe('fetched just now')
  })

  it('explains a missing catalog and an old Host', () => {
    expect(pricingStatusLine({ pricing: { ...pricing, fetchedAt: null, lastError: 'HTTP 503' }, fetchedAge: null })).toBe('HTTP 503')
    expect(pricingStatusLine({ pricing: null, fetchedAge: null })).toBe('This Host predates cost estimates; restart DSH to load them.')
  })
})
