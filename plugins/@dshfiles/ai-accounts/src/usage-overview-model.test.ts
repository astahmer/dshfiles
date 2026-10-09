import { describe, expect, it } from 'vitest'
import { createUsageCache } from './account-usage.js'
import type { AccountsUsage } from './api.js'
import { bankedExpiries, bindingWindow, footerSummary, formatAge, formatResetIn, formatResetShort, overviewCards, overviewProviders } from './usage-overview-model.js'

const usage: AccountsUsage = {
  readAt: 0,
  hostName: 'mac',
  cards: [
    {
      instanceId: 'codex',
      displayName: 'Codex',
      kind: 'codex',
      enabled: true,
      usage: {
        status: 'ok',
        message: null,
        identity: null,
        plan: null,
        windows: [
          { label: 'Weekly limit', percentRemaining: 53, resetsAt: null },
          { label: 'Current session', percentRemaining: 69, resetsAt: null },
        ],
        bankedResets: 0,
        bankedResetExpiries: [],
      },
    },
    {
      instanceId: 'cc',
      displayName: 'Command Code',
      kind: 'commandcode',
      enabled: false,
      usage: {
        status: 'ok',
        message: null,
        identity: null,
        plan: null,
        windows: [{ label: 'Current session', percentRemaining: 5, resetsAt: null }],
        bankedResets: 0,
        bankedResetExpiries: [],
      },
    },
  ],
}

describe('usage overview', () => {
  it('shows enabled accounts only, with session before weekly', () => {
    expect(overviewProviders(usage)).toEqual(['codex'])
    const cards = overviewCards(usage, 'all')
    expect(cards.map(card => card.instanceId)).toEqual(['codex'])
    expect(cards[0]?.usage.windows.map(window => window.label)).toEqual(['Current session', 'Weekly limit'])
    expect(overviewCards(usage, 'commandcode')).toEqual([])
  })

  it('takes the tightest window across enabled accounts only', () => {
    expect(footerSummary({ usage, accountIds: [], maxItems: 3 }).shown.map(item => [item.instanceId, item.percentRemaining])).toEqual([['codex', 53]])
    expect(footerSummary({ usage: null, accountIds: [], maxItems: 3 })).toEqual({ shown: [], hidden: [] })
  })

  it('formats resets and ages like the reference footer', () => {
    expect(formatResetShort((4 * 24 + 12) * 3_600_000, 0)).toBe('4d 12h')
    expect(formatResetShort(null, 0)).toBeNull()
    expect(formatResetIn(0 + (1 * 60 + 11) * 60_000 + 30_000, 0)).toBe('Resets in 1h 11m')
    expect(formatResetIn((5 * 24 + 20) * 3_600_000 + 1, 0)).toBe('Resets in 5d 20h')
    expect(formatResetIn(10, 20)).toBe('Resetting now')
    expect(formatAge(0, (4 * 60 + 38) * 1000)).toBe('00:04:38')
    expect(bankedExpiries([3, null, 1])).toEqual([1, 3, null])
  })
})

const window = (label: string, percentRemaining: number, resetsAt: number | null) => ({ label, percentRemaining, resetsAt })

const card = (instanceId: string, windows: ReturnType<typeof window>[], overrides: Partial<AccountsUsage['cards'][number]> = {}): AccountsUsage['cards'][number] => ({
  instanceId,
  displayName: instanceId,
  kind: 'codex',
  enabled: true,
  usage: { status: 'ok', message: null, identity: null, plan: null, windows, bankedResets: 0, bankedResetExpiries: [] },
  ...overrides,
})

const HOUR = 3_600_000

describe('footer summary', () => {
  it('binds an account to its spent window that resets last', () => {
    const blocked = card('blocked', [window('Current session', 0, 2 * HOUR), window('Current session', 100, HOUR), window('Weekly limit', 0.3, 100 * HOUR)])
    expect(bindingWindow(blocked)).toMatchObject({ windowLabel: 'Weekly limit', percentRemaining: 0.3, resetsAt: 100 * HOUR, exhausted: true })
  })

  it('binds a usable account to its lowest window, the sooner reset breaking a tie', () => {
    const usable = card('usable', [window('Weekly limit', 20, 50 * HOUR), window('Current session', 20, 3 * HOUR), window('Monthly', 80, HOUR)])
    expect(bindingWindow(usable)).toMatchObject({ windowLabel: 'Current session', resetsAt: 3 * HOUR, exhausted: false })
    expect(bindingWindow(card('off', [window('Weekly limit', 0, null)], { enabled: false }))).toBeUndefined()
    expect(bindingWindow({ ...usable, usage: { ...usable.usage, status: 'unauthenticated' } })).toBeUndefined()
  })

  it('ranks the most critical account first and folds the overflow into hidden', () => {
    const summary = footerSummary({
      usage: {
        readAt: 0,
        hostName: 'mac',
        cards: [card('roomy', [window('Weekly limit', 90, HOUR)]), card('spent', [window('Weekly limit', 0, 108 * HOUR)]), card('low', [window('Weekly limit', 20, 4 * HOUR)])],
      },
      accountIds: [],
      maxItems: 2,
    })
    expect(summary.shown.map(item => item.instanceId)).toEqual(['spent', 'low'])
    expect(summary.hidden.map(item => item.instanceId)).toEqual(['roomy'])
  })

  it('keeps only the picked accounts, and falls back to all when the pick is stale', () => {
    const picked: AccountsUsage = { readAt: 0, hostName: 'mac', cards: [card('a', [window('Weekly limit', 10, HOUR)]), card('b', [window('Weekly limit', 60, HOUR)])] }
    expect(footerSummary({ usage: picked, accountIds: ['b'], maxItems: 3 }).shown.map(item => item.instanceId)).toEqual(['b'])
    expect(footerSummary({ usage: picked, accountIds: ['gone'], maxItems: 3 }).shown.map(item => item.instanceId)).toEqual(['a', 'b'])
    expect(footerSummary({ usage: picked, accountIds: [], maxItems: 0 }).shown).toHaveLength(1)
  })

  it('sinks accounts with a spent window below usable ones in the popover', () => {
    const cards = overviewCards(
      { readAt: 0, hostName: 'mac', cards: [card('spent', [window('Weekly limit', 0, HOUR)]), card('usable', [window('Weekly limit', 40, HOUR)])] },
      'all',
    )
    expect(cards.map(item => item.instanceId)).toEqual(['usable', 'spent'])
  })
})

describe('usage cache', () => {
  it('shares one read between surfaces within the TTL and refreshes on demand', async () => {
    let clock = 0
    let reads = 0
    const cache = createUsageCache({ ttlMs: 30_000, now: () => clock, read: async () => ++reads })
    expect(await Promise.all([cache.get(), cache.get()])).toEqual([1, 1])
    clock = 29_999
    expect(await cache.get()).toBe(1)
    expect(await cache.refresh()).toBe(2)
    clock = 70_000
    expect(await cache.get()).toBe(3)
    cache.invalidate()
    expect(await cache.get()).toBe(4)
  })
})
