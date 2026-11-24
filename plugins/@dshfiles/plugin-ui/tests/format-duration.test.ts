import { describe, expect, it } from 'vitest'
import { formatElapsed as formatElapsedFromClock } from '../src/components/live-elapsed.js'
import { formatDurationMs, formatElapsed } from '../src/lib/format-duration.js'

describe('formatDurationMs', () => {
  it('formats microseconds through hours with one rule', () => {
    expect([0.25, 4.5, 42.25, 420, 1_500, 9_960, 42_000, 59_600, 84_000, 120_000, 185_000, 3_600_000, 7_800_000].map(formatDurationMs)).toEqual([
      '250µs',
      '4.5ms',
      '42ms',
      '420ms',
      '1.5s',
      '10s',
      '42s',
      '59s',
      '1m 24s',
      '2m 00s',
      '3m 05s',
      '1h 00m',
      '2h 10m',
    ])
  })

  it('clamps negative durations to zero', () => {
    expect(formatDurationMs(-50)).toBe('0µs')
  })
})

describe('formatElapsed', () => {
  it('floors to whole seconds and pads after minutes and hours', () => {
    expect([0, 999, 9_400, 59_999, 72_000, 125_000, 3_599_999, 3_840_000].map(formatElapsed)).toEqual([
      '0s',
      '0s',
      '9s',
      '59s',
      '1m 12s',
      '2m 05s',
      '59m 59s',
      '1h 04m',
    ])
  })

  it('clamps negative durations to zero', () => {
    expect(formatElapsed(-5_000)).toBe('0s')
  })

  it('is the same function the live clock module exports', () => {
    expect(formatElapsedFromClock).toBe(formatElapsed)
  })
})
