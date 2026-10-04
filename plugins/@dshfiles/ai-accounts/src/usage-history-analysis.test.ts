import { describe, expect, it } from 'vitest'
import { changedBankedResetSnapshots, forecastQuotaWindow, quotaHistoryCycles } from './usage-history-analysis.js'
import type { UsageHistoryPoint } from './usage-history-model.js'

const point = (at: number, remaining: number, resetsAt: number, bankedResets = 0, expiries: (number | null)[] = []): UsageHistoryPoint => ({
  at,
  windows: { Weekly: remaining },
  resetsAt: { Weekly: resetsAt },
  bankedResets,
  bankedResetExpiries: expiries,
})

describe('quota usage-history analysis', () => {
  it('projects depletion from recent snapshots in the same reset cycle', () => {
    const points = [point(0, 100, 7_200_000), point(1_800_000, 70, 7_200_000), point(3_600_000, 40, 7_200_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 40, resetsAt: 7_200_000, now: 3_600_000 })).toMatchObject({
      status: 'depletes-before-reset',
      sampleCount: 3,
      estimatedAt: 6_000_000,
    })
  })

  it('does not carry a trend across a provider reset boundary', () => {
    const points = [point(0, 10, 1_000_000), point(1_800_000, 100, 2_000_000), point(3_600_000, 90, 2_000_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 90, resetsAt: 2_000_000, now: 3_600_000 })).toMatchObject({
      status: 'insufficient-history',
      sampleCount: 2,
    })
    expect(quotaHistoryCycles(points, 'Weekly')).toHaveLength(2)
  })

  it('reports reset-first when the current pace would run past the provider reset', () => {
    const points = [point(0, 100, 4_000_000), point(1_800_000, 70, 4_000_000), point(3_600_000, 40, 4_000_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 40, resetsAt: 4_000_000, now: 3_600_000 }).status)
      .toBe('reset-before-depletion')
  })

  it('requires enough elapsed history and avoids a depletion forecast when usage is stable', () => {
    expect(forecastQuotaWindow({
      points: [point(0, 80, 9_000_000), point(1_000_000, 80, 9_000_000)],
      label: 'Weekly', remainingPercent: 80, resetsAt: 9_000_000, now: 1_000_000,
    }).status).toBe('insufficient-history')
    expect(forecastQuotaWindow({
      points: [point(0, 80, 9_000_000), point(1_800_000, 80, 9_000_000), point(3_600_000, 82, 9_000_000)],
      label: 'Weekly', remainingPercent: 82, resetsAt: 9_000_000, now: 3_600_000,
    }).status).toBe('no-depletion')
  })

  it('keeps reset-bank snapshots only when count or expiry data changes', () => {
    const points = [
      point(0, 100, 9_000_000, 1, [8_000_000]),
      point(900_000, 95, 9_000_000, 1, [8_000_000]),
      point(1_800_000, 90, 9_000_000, 2, [8_000_000, null]),
      point(2_700_000, 85, 9_000_000, 2, [8_000_000, 7_000_000]),
    ]
    expect(changedBankedResetSnapshots(points).map(snapshot => snapshot.at)).toEqual([0, 1_800_000, 2_700_000])
  })
})
