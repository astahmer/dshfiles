import { describe, expect, it } from 'vitest'
import { quotaRetryAt, quotaRetryDelayMs } from './quota-retry-backoff.js'

describe('quota retry backoff', () => {
  it('backs off 30 s, 1 min, 3 min, 5 min, then every 10 min', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(quotaRetryDelayMs)).toEqual([30_000, 60_000, 180_000, 300_000, 600_000, 600_000, 600_000, 600_000])
  })

  it('treats a missing or impossible attempt as the first rung', () => {
    expect([-3, Number.NaN, 1.5].map(quotaRetryDelayMs)).toEqual([30_000, 30_000, 30_000])
  })

  it('counts the retry from the failure it recorded', () => {
    expect(quotaRetryAt({ failedAt: 1_000_000, attempt: 0 })).toBe(1_030_000)
    expect(quotaRetryAt({ failedAt: 1_000_000, attempt: 2 })).toBe(1_180_000)
  })
})
