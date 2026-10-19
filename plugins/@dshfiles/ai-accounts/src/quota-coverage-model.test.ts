import { describe, expect, it } from 'vitest'
import type { UsageHistoryPoint } from './api.js'
import { QuotaCoverageModel, type CoverageAccountInput } from './quota-coverage-model.js'

const HOUR = 3_600_000
// Monday 5 October 2026; the report runs on the following Wednesday, so this is last week.
const weekStart = new Date(2026, 9, 5).getTime()
const now = new Date(2026, 9, 14, 10, 0).getTime()
const at = (day: number, hour: number): number => new Date(2026, 9, 5 + day, hour).getTime()

/** Hourly readings over the week: spent (0 left) inside `spent`, otherwise 40 left. */
const hourly = (spent: { readonly from: number; readonly to: number }): readonly UsageHistoryPoint[] =>
  Array.from({ length: 168 }, (_, index) => {
    const time = weekStart + index * HOUR + 10 * 60_000
    const remaining = time >= spent.from && time < spent.to ? 0 : 40
    return { at: time, windows: { 'Weekly limit': remaining }, resetsAt: { 'Weekly limit': spent.to }, bankedResets: 0, bankedResetExpiries: [] }
  })

const account = (instanceId: string, points: readonly UsageHistoryPoint[]): CoverageAccountInput => ({
  instanceId,
  displayName: instanceId,
  kind: 'claude',
  points,
  forecast: undefined,
})

describe('QuotaCoverageModel.report', () => {
  it('counts the working hours when every account of a kind was spent at once', () => {
    const max = account('Max', hourly({ from: at(3, 17), to: at(6, 6) }))
    const proSide = account('Pro Side', hourly({ from: at(4, 11), to: at(6, 6) }))

    const report = QuotaCoverageModel.report({ accounts: [max, proSide], now })
    const pool = report.groups[0]
    if (pool?.status !== 'pool') throw new Error('expected a pool')
    const lastWeek = pool.weeks.at(-2)

    expect(lastWeek?.start).toBe(weekStart)
    // Friday 11:00 to 18:00 is the only working time with nothing free.
    expect(lastWeek?.noneFreeWorkHours).toBe(7)
    expect(lastWeek?.longestNoneFree).toEqual({ start: at(4, 11), end: at(6, 6) })
    expect(lastWeek?.lanes.map(lane => lane.firstSpentAt)).toEqual([at(3, 17), at(4, 11)])
    // Pro Side covers Thursday 17:00 to 18:00 and Friday 09:00 to 11:00.
    expect(lastWeek?.coveredWorkHours).toBe(3)
    expect(lastWeek?.free.map(cell => cell.kind).filter(kind => kind === 'none-work')).toHaveLength(2)
  })

  it('keeps a lone account out of the pools and counts how often it ran out', () => {
    const copilot = { ...account('Copilot', hourly({ from: at(1, 9), to: at(1, 12) })), kind: 'github-copilot' as const }
    const report = QuotaCoverageModel.report({ accounts: [copilot], now })

    expect(report.groups).toEqual([{ status: 'single', kind: 'github-copilot', instanceId: 'Copilot', displayName: 'Copilot', spentEpisodes: 1 }])
  })
})
