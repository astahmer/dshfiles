import { describe, expect, it } from 'vitest'
import { nextQuotaTickDelayMs } from './quota-clock.js'

describe('nextQuotaTickDelayMs', () => {
  it('waits for the next minute boundary when no reset is closer', () => {
    expect(nextQuotaTickDelayMs({ now: 1_800_000_030_000, resetsAt: [] })).toBe(30_000)
    expect(nextQuotaTickDelayMs({ now: 1_800_000_000_000, resetsAt: [null] })).toBe(60_000)
  })

  it('wakes at a reset that lands before the next minute', () => {
    expect(nextQuotaTickDelayMs({ now: 1_800_000_030_000, resetsAt: [1_800_000_045_000] })).toBe(15_000)
  })

  it('ignores resets that have already passed or are not finite', () => {
    expect(nextQuotaTickDelayMs({ now: 1_800_000_030_000, resetsAt: [1_800_000_000_000, Number.NaN, null] })).toBe(30_000)
  })

  it('keeps a second-resolution readout ticking every second', () => {
    expect(nextQuotaTickDelayMs({ now: 1_800_000_030_000, resetsAt: [1_800_000_045_000], precision: 'second' })).toBe(1_000)
  })

  it('never schedules a zero-delay wake-up on a boundary', () => {
    const onBoundary = nextQuotaTickDelayMs({ now: 1_800_000_060_000, resetsAt: [] })
    expect(onBoundary).toBe(60_000)
    expect(nextQuotaTickDelayMs({ now: 1_800_000_060_000, resetsAt: [1_800_000_060_000] })).toBeGreaterThan(0)
  })
})
