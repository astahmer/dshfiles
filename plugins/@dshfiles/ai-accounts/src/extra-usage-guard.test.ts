import { describe, expect, it } from 'vitest'
import { createAccountPool } from './account-pool.js'
import type { AccountsUsage, UsageCard } from './api.js'
import { ExtraUsageGuardModel, UNKNOWN_RESET_HOLD_MS } from './extra-usage-guard.js'

const NOW = Date.now()
const HOUR = 3_600_000
const resetLabel = (resetsAt: number): string => `in ${String(Math.round((resetsAt - NOW) / HOUR))} h`

const usageCard = (input: {
  readonly windows: readonly { readonly label: string; readonly percentRemaining: number; readonly resetsAt?: number | null; readonly reserve?: boolean }[]
  readonly extraUsage?: { readonly enabled: boolean } | undefined
}): UsageCard => ({
  status: 'ok',
  message: null,
  identity: null,
  plan: 'max',
  windows: input.windows.map(window => ({
    label: window.label,
    percentRemaining: window.percentRemaining,
    resetsAt: window.resetsAt === undefined ? NOW + 3 * 24 * HOUR : window.resetsAt,
    ...(window.reserve === true && { reserve: true }),
  })),
  bankedResets: 0,
  bankedResetExpiries: [],
  ...(input.extraUsage !== undefined && {
    extraUsage: {
      enabled: input.extraUsage.enabled,
      used: 159.33,
      monthlyLimit: 200,
      currency: 'EUR',
      percentUsed: 79.67,
      resetsAt: null,
    },
  }),
})

const spentWeekly = (): UsageCard =>
  usageCard({
    windows: [
      { label: 'Current session', percentRemaining: 64, resetsAt: NOW + 2 * HOUR },
      { label: 'Weekly limit', percentRemaining: 0, resetsAt: NOW + 36 * HOUR },
    ],
    extraUsage: { enabled: true },
  })

describe('extra usage guard', () => {
  it('blocks a spent plan window while the account may not draw paid overage', () => {
    const block = ExtraUsageGuardModel.block({ usage: spentWeekly(), useExtraUsage: false, now: NOW })
    expect(block).toEqual({ blocked: true, window: 'Weekly limit', resetsAt: NOW + 36 * HOUR })
    expect(ExtraUsageGuardModel.until({ block, now: NOW })).toBe(NOW + 36 * HOUR)
  })

  it('lets the same reading through once the account may use extra usage', () => {
    expect(ExtraUsageGuardModel.block({ usage: spentWeekly(), useExtraUsage: true, now: NOW })).toEqual({
      blocked: false,
      window: null,
      resetsAt: null,
    })
  })

  it('counts a spent session window as exhausted even while the weekly window has quota', () => {
    const card = usageCard({
      windows: [
        { label: 'Current session', percentRemaining: 0, resetsAt: NOW + HOUR },
        { label: 'Weekly limit', percentRemaining: 40, resetsAt: NOW + 36 * HOUR },
      ],
      extraUsage: { enabled: true },
    })
    expect(ExtraUsageGuardModel.block({ usage: card, useExtraUsage: false, now: NOW })).toMatchObject({ blocked: true, window: 'Current session' })
  })

  it('leaves a model-scoped window, a spent reserve and an already reset window alone', () => {
    const scoped = usageCard({
      windows: [
        { label: 'Current session', percentRemaining: 70, resetsAt: NOW + HOUR },
        { label: 'Weekly limit', percentRemaining: 30, resetsAt: NOW + 36 * HOUR },
        { label: 'Weekly Opus', percentRemaining: 0, resetsAt: NOW + 36 * HOUR },
        { label: 'Luna Reserve', percentRemaining: 0, resetsAt: null, reserve: true },
      ],
      extraUsage: { enabled: true },
    })
    expect(ExtraUsageGuardModel.block({ usage: scoped, useExtraUsage: false, now: NOW }).blocked).toBe(false)
    const reset = usageCard({
      windows: [{ label: 'Weekly limit', percentRemaining: 0, resetsAt: NOW - HOUR }],
      extraUsage: { enabled: true },
    })
    expect(ExtraUsageGuardModel.block({ usage: reset, useExtraUsage: false, now: NOW }).blocked).toBe(false)
  })

  it('ignores accounts whose provider reports no overage or has it switched off', () => {
    expect(
      ExtraUsageGuardModel.block({ usage: usageCard({ windows: [{ label: 'Weekly limit', percentRemaining: 0 }] }), useExtraUsage: false, now: NOW }).blocked,
    ).toBe(false)
    const switchedOff = usageCard({ windows: [{ label: 'Weekly limit', percentRemaining: 0 }], extraUsage: { enabled: false } })
    expect(ExtraUsageGuardModel.block({ usage: switchedOff, useExtraUsage: false, now: NOW }).blocked).toBe(false)
  })

  it('holds a spent window that reports no reset for a bounded time', () => {
    const card = usageCard({ windows: [{ label: 'Monthly limit', percentRemaining: 0, resetsAt: null }], extraUsage: { enabled: true } })
    const block = ExtraUsageGuardModel.block({ usage: card, useExtraUsage: false, now: NOW })
    expect(block).toEqual({ blocked: true, window: 'Monthly limit', resetsAt: null })
    expect(ExtraUsageGuardModel.until({ block, now: NOW })).toBe(NOW + UNKNOWN_RESET_HOLD_MS)
  })

  it('keeps routing off the account until its reset, then lets it back in', () => {
    const pool = createAccountPool()
    pool.put({ id: 'claude-spent', kind: 'claude', label: 'Claude Spent' })
    pool.put({ id: 'claude-open', kind: 'claude', label: 'Claude Open' })
    const usage: AccountsUsage = {
      readAt: NOW,
      hostName: 'test-host',
      cards: [{ instanceId: 'claude-spent', displayName: 'Claude Spent', kind: 'claude', enabled: true, usage: spentWeekly() }],
    }
    ExtraUsageGuardModel.apply({ pool, accounts: [{ instanceId: 'claude-spent', useExtraUsage: false }], usage, now: NOW })

    expect(pool.isHealthy('claude-spent', NOW)).toBe(false)
    expect(pool.planBlocked('claude-spent', NOW)).toBe(true)
    expect(pool.acquire({ candidateIds: ['claude-spent'], now: NOW })?.id).toBeUndefined()
    expect(pool.describe()[0]?.state).toBe('exhausted')
    expect(pool.isHealthy('claude-spent', NOW + 36 * HOUR + 1)).toBe(true)

    ExtraUsageGuardModel.apply({ pool, accounts: [{ instanceId: 'claude-spent', useExtraUsage: true }], usage, now: NOW })
    expect(pool.planBlocked('claude-spent', NOW)).toBe(false)
    expect(pool.acquire({ candidateIds: ['claude-spent'] })?.id).toBe('claude-spent')
  })

  it('never clears a block from a reading that does not carry the account', () => {
    const pool = createAccountPool()
    pool.put({ id: 'claude-spent', kind: 'claude', label: 'Claude Spent' })
    ExtraUsageGuardModel.apply({
      pool,
      accounts: [{ instanceId: 'claude-spent' }],
      usage: {
        readAt: NOW,
        hostName: 'test-host',
        cards: [{ instanceId: 'claude-spent', displayName: 'Claude Spent', kind: 'claude', enabled: true, usage: spentWeekly() }],
      },
      now: NOW,
    })
    ExtraUsageGuardModel.apply({ pool, accounts: [{ instanceId: 'claude-spent' }], usage: undefined, now: NOW })
    expect(pool.planBlocked('claude-spent', NOW)).toBe(true)
  })

  it('names the spent window, the reset, another account and the setting to turn on', () => {
    const block = ExtraUsageGuardModel.block({ usage: spentWeekly(), useExtraUsage: false, now: NOW })
    const message = ExtraUsageGuardModel.recoveryMessage({ displayName: 'Claude Work', block, formatReset: resetLabel })
    expect(message).toContain('The Weekly limit is spent for Claude Work')
    expect(message).toContain('extra usage is off for that account')
    expect(message).toContain('Turn on "Use extra usage"')
    expect(message).toContain('switch this thread to another account')
    expect(message).toContain('wait until in 36 h')
  })
})
