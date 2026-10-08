import { describe, expect, it } from 'vitest'
import { createUsageCache } from './account-usage.js'
import type { AccountsUsage } from './api.js'
import { bankedExpiries, formatAge, formatResetIn, overviewCards, overviewProviders, tightestRemaining } from './usage-overview-model.js'

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
    expect(tightestRemaining(usage)).toBe(53)
    expect(tightestRemaining(null)).toBeUndefined()
  })

  it('formats resets and ages like the reference footer', () => {
    expect(formatResetIn(0 + (1 * 60 + 11) * 60_000 + 30_000, 0)).toBe('Resets in 1h 11m')
    expect(formatResetIn((5 * 24 + 20) * 3_600_000 + 1, 0)).toBe('Resets in 5d 20h')
    expect(formatResetIn(10, 20)).toBe('Resetting now')
    expect(formatAge(0, (4 * 60 + 38) * 1000)).toBe('00:04:38')
    expect(bankedExpiries([3, null, 1])).toEqual([1, 3, null])
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
