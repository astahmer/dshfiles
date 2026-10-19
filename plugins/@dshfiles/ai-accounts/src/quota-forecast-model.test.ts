import { describe, expect, it } from 'vitest'
import type { UsageCard, UsageHistoryPoint } from './api.js'
import { QuotaForecastModel, type ForecastAccountInput } from './quota-forecast-model.js'

const HOUR = 3_600_000
const now = new Date(2026, 9, 15, 14, 0).getTime()

const card = (windows: UsageCard['windows']): UsageCard => ({
  status: 'ok',
  message: null,
  identity: null,
  plan: null,
  windows,
  bankedResets: 0,
  bankedResetExpiries: [],
})

const point = (at: number, windows: Record<string, number>, resetsAt: Record<string, number>): UsageHistoryPoint => ({
  at,
  windows,
  resetsAt,
  bankedResets: 0,
  bankedResetExpiries: [],
})

const account = (instanceId: string, usage: UsageCard | undefined, points: readonly UsageHistoryPoint[] = []): ForecastAccountInput => ({
  instanceId,
  displayName: instanceId,
  kind: 'claude',
  usage,
  points,
})

describe('QuotaForecastModel.board', () => {
  it('reports the lock between running out and the reset', () => {
    const resetsAt = now + 96 * HOUR
    const fast = account('fast', card([{ label: 'Weekly limit', percentRemaining: 40, resetsAt }]), [
      point(now - 24 * HOUR, { 'Weekly limit': 64 }, { 'Weekly limit': resetsAt }),
    ])

    const board = QuotaForecastModel.board({ accounts: [fast], now })
    const forecast = board.accounts[0]
    if (forecast?.status !== 'forecast') throw new Error('expected a forecast')

    expect(forecast.window.runsOutAt).toBe(now + 40 * HOUR)
    expect(forecast.window.lockedMs).toBe(56 * HOUR)
    expect(board.runsOutCount).toBe(1)
    const kinds = forecast.cells.map(cell => cell.kind)
    expect(kinds.indexOf('runs-out')).toBeLessThan(kinds.indexOf('locked'))
    expect(kinds.indexOf('locked')).toBeLessThan(kinds.indexOf('fresh'))
    expect(forecast.cells.find(cell => cell.kind === 'fresh')?.start).toBeGreaterThanOrEqual(resetsAt)
  })

  it('projects use at reset when the pace lasts, and sorts by urgency with unreadable accounts last', () => {
    const resetsAt = now + 48 * HOUR
    const slow = account('slow', card([{ label: 'Weekly limit', percentRemaining: 70, resetsAt }]), [
      point(now - 24 * HOUR, { 'Weekly limit': 76 }, { 'Weekly limit': resetsAt }),
    ])
    const fast = account('fast', card([{ label: 'Weekly limit', percentRemaining: 10, resetsAt }]), [
      point(now - 24 * HOUR, { 'Weekly limit': 40 }, { 'Weekly limit': resetsAt }),
    ])
    const signedOut = account('signed-out', { ...card([]), status: 'unauthenticated' })

    const board = QuotaForecastModel.board({ accounts: [signedOut, slow, fast], now })

    expect(board.accounts.map(entry => entry.instanceId)).toEqual(['fast', 'slow', 'signed-out'])
    const projected = board.accounts[1]
    if (projected?.status !== 'forecast') throw new Error('expected a forecast')
    expect(projected.window.usedAtReset).toBeCloseTo(42)
    expect(board.accounts[2]).toMatchObject({ status: 'unavailable', reason: 'reconnect' })
  })

  it('lets a weekly limit govern the board over a session window that runs out first', () => {
    const sessionReset = now + 3 * HOUR
    const weeklyReset = now + 100 * HOUR
    const both = account(
      'both',
      card([
        { label: 'Current session', percentRemaining: 5, resetsAt: sessionReset },
        { label: 'Weekly limit', percentRemaining: 80, resetsAt: weeklyReset },
      ]),
      [point(now - HOUR, { 'Current session': 50, 'Weekly limit': 82 }, { 'Current session': sessionReset, 'Weekly limit': weeklyReset })],
    )

    const forecast = QuotaForecastModel.board({ accounts: [both], now }).accounts[0]
    if (forecast?.status !== 'forecast') throw new Error('expected a forecast')

    expect(forecast.window.label).toBe('Weekly limit')
    expect(forecast.others.map(other => other.label)).toEqual(['Current session'])
  })
})
