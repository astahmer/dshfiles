import { describe, expect, it } from 'vitest'
import { boundUsageHistoryPoints, parseUsageBucketKey, usageBucketKey } from './usage-history.js'
import { changedBankedResetSnapshots, forecastQuotaWindow, quotaHistoryCycles } from './usage-history-analysis.js'
import { MAX_USAGE_HISTORY_POINTS, type UsageHistoryPoint } from './usage-history-model.js'

const point = (at: number, remaining: number, resetsAt: number, bankedResets = 0, expiries: (number | null)[] = []): UsageHistoryPoint => ({
  at,
  windows: { Weekly: remaining },
  resetsAt: { Weekly: resetsAt },
  bankedResets,
  bankedResetExpiries: expiries,
})

describe('quota usage-history analysis', () => {
  it('keys snapshots by the configured interval and still recognizes legacy 15-minute buckets', () => {
    const at = 3_600_123
    expect(usageBucketKey('codex:personal', at, 5)).toBe(`v2:codex%3Apersonal:5:${String(Math.floor(at / (5 * 60_000)))}`)
    expect(parseUsageBucketKey('codex:personal:240')).toEqual({
      instanceId: 'codex:personal',
      bucket: 240,
      intervalMinutes: 15,
    })
    expect(parseUsageBucketKey(usageBucketKey('codex:personal', at, 5))).toEqual({
      instanceId: 'codex:personal',
      bucket: Math.floor(at / (5 * 60_000)),
      intervalMinutes: 5,
    })
    expect(usageBucketKey('codex:personal', at, 5)).not.toBe(usageBucketKey('codex:personal', at, 15))
  })

  it('bounds long history reads while preserving recent forecasts and reset-bank changes', () => {
    const snapshots = Array.from({ length: 10_000 }, (_, index) => ({
      ...point(
        index * 60_000,
        100 - index % 100,
        (Math.floor(index / 1_000) + 1) * 1_000_000,
        Math.floor(index / 200),
      ),
      instanceId: 'codex',
    }))
    const bounded = boundUsageHistoryPoints(snapshots)
    const recordedTimes = new Set(bounded.map(snapshot => snapshot.at))

    expect(bounded).toHaveLength(MAX_USAGE_HISTORY_POINTS)
    expect(recordedTimes.has(snapshots[0]?.at ?? -1)).toBe(true)
    expect(recordedTimes.has(snapshots.at(-1)?.at ?? -1)).toBe(true)
    for (let index = 200; index < snapshots.length; index += 200) {
      expect(recordedTimes.has(snapshots[index]?.at ?? -1)).toBe(true)
    }
    for (let index = 1_000; index < snapshots.length; index += 1_000) {
      expect(recordedTimes.has(snapshots[index]?.at ?? -1)).toBe(true)
    }
    for (let index = snapshots.length - 48; index < snapshots.length; index += 1) {
      expect(recordedTimes.has(snapshots[index]?.at ?? -1)).toBe(true)
    }
  })

  it('projects depletion from recent snapshots in the same reset cycle', () => {
    const points = [point(0, 100, 7_200_000), point(1_800_000, 70, 7_200_000), point(3_600_000, 40, 7_200_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 40, resetsAt: 7_200_000, now: 3_600_000 })).toMatchObject({
      status: 'depletes-before-reset',
      sampleCount: 3,
      estimatedAt: 6_000_000,
    })
  })

  it('does not carry a trend across a provider reset boundary', () => {
    const points = [point(0, 10, 1_000_000), point(1_800_000, 100, 6_000_000), point(3_600_000, 70, 6_000_000), point(5_400_000, 40, 6_000_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 40, resetsAt: 6_000_000, now: 5_400_000 })).toMatchObject({
      status: 'reset-before-depletion',
      sampleCount: 3,
    })
    expect(quotaHistoryCycles(points, 'Weekly')).toHaveLength(2)
  })

  it('reports reset-due once the current reset time has passed', () => {
    const points = [point(0, 10, 1_000_000), point(1_800_000, 100, 2_000_000), point(3_600_000, 90, 2_000_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 90, resetsAt: 2_000_000, now: 3_600_000 })).toMatchObject({
      status: 'reset-due',
      sampleCount: 0,
    })
  })

  it('reports reset-first when the current pace would run past the provider reset', () => {
    const points = [point(0, 100, 4_000_000), point(1_800_000, 70, 4_000_000), point(3_600_000, 40, 4_000_000)]
    expect(forecastQuotaWindow({ points, label: 'Weekly', remainingPercent: 40, resetsAt: 4_000_000, now: 3_600_000 }).status).toBe('reset-before-depletion')
  })

  it('requires enough elapsed history and avoids a depletion forecast when usage is stable', () => {
    expect(
      forecastQuotaWindow({
        points: [point(0, 80, 9_000_000), point(1_000_000, 80, 9_000_000)],
        label: 'Weekly',
        remainingPercent: 80,
        resetsAt: 9_000_000,
        now: 1_000_000,
      }).status,
    ).toBe('insufficient-history')
    expect(
      forecastQuotaWindow({
        points: [point(0, 80, 9_000_000), point(1_800_000, 80, 9_000_000), point(3_600_000, 82, 9_000_000)],
        label: 'Weekly',
        remainingPercent: 82,
        resetsAt: 9_000_000,
        now: 3_600_000,
      }).status,
    ).toBe('no-depletion')
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
