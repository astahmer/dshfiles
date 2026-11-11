import { describe, expect, it } from 'vitest'
import { formatDurationMs } from '../src/lib/format-duration.js'

describe('formatDurationMs', () => {
  it('formats microseconds through hours with one rule', () => {
    expect([0.25, 4.5, 42.25, 420, 1_500, 42_000, 59_600, 84_000, 120_000, 185_000, 3_600_000, 7_800_000].map(formatDurationMs)).toEqual([
      '250µs',
      '4.5ms',
      '42ms',
      '420ms',
      '1.5s',
      '42s',
      '1m',
      '1m 24s',
      '2m',
      '3m 5s',
      '1h',
      '2h 10m',
    ])
  })

  it('clamps negative durations to zero', () => {
    expect(formatDurationMs(-50)).toBe('0µs')
  })
})
