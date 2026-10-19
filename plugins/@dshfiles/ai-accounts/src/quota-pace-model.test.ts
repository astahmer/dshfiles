import { describe, expect, it } from 'vitest'
import type { UsageCard, UsageHistoryPoint } from './api.js'
import { QuotaForecastModel } from './quota-forecast-model.js'
import { QuotaPaceModel } from './quota-pace-model.js'

const HOUR = 3_600_000
const WEEK = 168 * HOUR
const now = new Date(2026, 9, 15, 12).getTime()
const label = 'Weekly limit'

const point = (at: number, remaining: number, resetsAt: number): UsageHistoryPoint => ({
  at,
  windows: { [label]: remaining },
  resetsAt: { [label]: resetsAt },
  bankedResets: 0,
  bankedResetExpiries: [],
})

const card = (remaining: number, resetsAt: number): UsageCard => ({
  status: 'ok',
  message: null,
  identity: null,
  plan: null,
  windows: [{ label, percentRemaining: remaining, resetsAt }],
  bankedResets: 0,
  bankedResetExpiries: [],
})

describe('QuotaPaceModel', () => {
  it('measures each account against even pace on one window axis, fastest first', () => {
    // Both windows are half elapsed: 72% used is 1.44x even pace, 20% is 0.4x.
    const resetsAt = now + WEEK / 2
    const board = QuotaForecastModel.board({
      now,
      accounts: [
        { instanceId: 'slow', displayName: 'slow', kind: 'codex', usage: card(80, resetsAt), points: [point(now - 24 * HOUR, 82, resetsAt)] },
        { instanceId: 'fast', displayName: 'fast', kind: 'claude', usage: card(28, resetsAt), points: [point(now - 24 * HOUR, 40, resetsAt)] },
      ],
    })

    const pace = QuotaPaceModel.current(board)

    expect(pace.map(account => account.instanceId)).toEqual(['fast', 'slow'])
    expect(pace[0]?.ratio).toBeCloseTo(1.44)
    expect(pace[0]?.x).toBeCloseTo(0.5)
    expect(pace[0]?.projection.at(-1)).toEqual({ x: 1, used: 100 })
    expect(pace[1]?.ratio).toBeCloseTo(0.4)
  })

  it('replays finished windows newest first and marks where one ran out', () => {
    const firstReset = now - WEEK
    const points = [
      point(firstReset - WEEK / 2, 50, firstReset),
      point(firstReset - HOUR, 30, firstReset),
      point(now - WEEK / 2, 40, now),
      point(now - WEEK / 3, 20, now + 4_000),
      point(now - WEEK / 4, 0, now),
      point(now + HOUR, 90, now + WEEK),
    ]

    const past = QuotaPaceModel.pastWindows({ points, label, lengthMs: WEEK, now })

    expect(past.map(window => window.resetsAt)).toEqual([now, firstReset])
    expect(past[0]).toMatchObject({ finalUsed: 100, ranOutX: 0.75, lockedMs: WEEK / 4 })
    expect(past[1]).toMatchObject({ finalUsed: 70, ranOutX: null, endedEarly: false })
  })

  it('ends a window at the next one when a banked reset restarted it early', () => {
    const points = [point(now - WEEK / 2, 0, now), point(now - WEEK / 4, 100, now + WEEK * 0.75), point(now + HOUR, 90, now + WEEK * 0.75)]

    const [restarted] = QuotaPaceModel.pastWindows({ points, label, lengthMs: WEEK, now: now + 2 * HOUR })

    expect(restarted).toMatchObject({ resetsAt: now, endedEarly: true, lockedMs: WEEK / 4 })
  })
})
