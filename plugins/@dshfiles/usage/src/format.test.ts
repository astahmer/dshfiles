import { describe, expect, it } from 'vitest'
import { UsageFormattingModel } from './format.js'

describe('UsageFormattingModel', () => {
  it('formats counts, cost, and duration at display thresholds', () => {
    expect(UsageFormattingModel.formatCount(1_300)).toBe('1.3K')
    expect(UsageFormattingModel.formatCount(1_000_000)).toBe('1M')
    expect(UsageFormattingModel.formatCost(0.0456)).toBe('$0.0456')
    expect(UsageFormattingModel.formatCost(1_234)).toBe('$1,234')
    expect(UsageFormattingModel.formatDuration(820)).toBe('820ms')
    expect(UsageFormattingModel.formatDuration(84_000)).toBe('1m 24s')
  })

  it('uses an en dash for unknown values and guards empty ratios', () => {
    expect(UsageFormattingModel.formatCount(null)).toBe('–')
    expect(UsageFormattingModel.formatCost(null)).toBe('–')
    expect(UsageFormattingModel.formatDuration(null)).toBe('–')
    expect(UsageFormattingModel.formatPercent(null)).toBe('–')
    expect(UsageFormattingModel.formatAgo(1_000, 1_000, () => ({ n: 0, unit: 'now' }))).toBe('now')
    expect(UsageFormattingModel.cacheHitRatio({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
    expect(UsageFormattingModel.changeRatio(3, 0)).toBeNull()
  })

  it('labels request purposes and computes prompt cache share', () => {
    expect(UsageFormattingModel.purposeLabels.compaction).toBe('Compaction')
    expect(UsageFormattingModel.cacheHitRatio({ input: 10, cacheRead: 20, cacheWrite: 5 })).toBeCloseTo(20 / 35)
    expect(UsageFormattingModel.changeRatio(150, 100)).toBe(0.5)
  })
})
