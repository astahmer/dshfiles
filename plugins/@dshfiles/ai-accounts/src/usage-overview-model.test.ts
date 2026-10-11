import { describe, expect, it } from 'vitest'
import { createUsageCache } from './account-usage.js'
import type { AccountsUsage } from './api.js'
import {
  bankedExpiries,
  bindingWindow,
  formatAge,
  formatResetIn,
  formatResetShort,
  meterLines,
  moveAccount,
  mostCritical,
  overviewProviders,
  overviewSections,
  stripItems,
} from './usage-overview-model.js'

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

const noLayout = { order: [], hidden: [] }

describe('usage overview', () => {
  it('shows enabled accounts only, with session before weekly', () => {
    expect(overviewProviders(usage)).toEqual(['codex'])
    const cards = overviewSections(usage, 'all', noLayout).cards
    expect(cards.map(card => card.instanceId)).toEqual(['codex'])
    expect(cards[0]?.usage.windows.map(window => window.label)).toEqual(['Current session', 'Weekly limit'])
    expect(overviewSections(usage, 'commandcode', noLayout).cards).toEqual([])
  })

  it('takes the tightest window across enabled accounts only', () => {
    expect(stripItems(usage, noLayout).map(item => [item.instanceId, item.percentRemaining])).toEqual([['codex', 53]])
    expect(stripItems(usage, noLayout)[0]?.windows?.map(window => [window.label, window.percentRemaining])).toEqual([
      ['Current session', 69],
      ['Weekly limit', 53],
    ])
    expect(stripItems(null, noLayout)).toEqual([])
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

  it('shows percent, reset or both on a meter, never neither', () => {
    const item = {
      instanceId: 'codex',
      displayName: 'Codex',
      kind: 'codex',
      windowLabel: 'Weekly',
      percentRemaining: 41.6,
      resetsAt: 2 * 3_600_000,
      exhausted: false,
      onReserve: false,
    } as const
    expect(meterLines(item, 0, 'both')).toEqual({ percent: '42%', reset: '↻ 2h 0m' })
    expect(meterLines(item, 0, 'percent')).toEqual({ percent: '42%', reset: null })
    expect(meterLines(item, 0, 'reset')).toEqual({ percent: null, reset: '↻ 2h 0m' })
    expect(meterLines({ ...item, resetsAt: null }, 0, 'reset')).toEqual({ percent: '42%', reset: null })
    expect(meterLines({ ...item, exhausted: true }, 3 * 3_600_000, 'both')).toEqual({ percent: 'Limit reached', reset: 'resetting' })
  })
})

const window = (label: string, percentRemaining: number, resetsAt: number | null) => ({ label, percentRemaining, resetsAt })

const card = (
  instanceId: string,
  windows: ReturnType<typeof window>[],
  overrides: Partial<AccountsUsage['cards'][number]> = {},
): AccountsUsage['cards'][number] => ({
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

  it('points a narrow surface at the most critical account', () => {
    const items = stripItems(
      {
        readAt: 0,
        hostName: 'mac',
        cards: [
          card('roomy', [window('Weekly limit', 90, HOUR)]),
          card('spent', [window('Weekly limit', 0, 108 * HOUR)]),
          card('low', [window('Weekly limit', 20, 4 * HOUR)]),
        ],
      },
      noLayout,
    )
    expect(items.map(item => item.instanceId)).toEqual(['roomy', 'low', 'spent'])
    expect(mostCritical(items)?.instanceId).toBe('spent')
  })

  it('sinks accounts with a spent window below usable ones until the user orders them', () => {
    const both: AccountsUsage = {
      readAt: 0,
      hostName: 'mac',
      cards: [card('spent', [window('Weekly limit', 0, HOUR)]), card('usable', [window('Weekly limit', 40, HOUR)])],
    }
    expect(overviewSections(both, 'all', noLayout).cards.map(item => item.instanceId)).toEqual(['usable', 'spent'])
    expect(overviewSections(both, 'all', { order: ['spent'], hidden: [] }).cards.map(item => item.instanceId)).toEqual(['spent', 'usable'])
  })
})

describe('usage layout', () => {
  const mixed: AccountsUsage = {
    readAt: 0,
    hostName: 'mac',
    cards: [
      card('a', [window('Weekly limit', 50, HOUR)]),
      card('signed-out', [], {
        usage: { status: 'unauthenticated', message: null, identity: null, plan: null, windows: [], bankedResets: 0, bankedResetExpiries: [] },
      }),
      card('b', [window('Weekly limit', 60, HOUR)]),
      card('c', [window('Weekly limit', 70, HOUR)]),
    ],
  }

  it('keeps accounts without quota data and hidden ones out of the cards and the strip', () => {
    const sections = overviewSections(mixed, 'all', { order: [], hidden: ['b', 'gone'] })
    expect(sections.cards.map(item => item.instanceId)).toEqual(['a', 'c'])
    expect(sections.unavailable.map(item => item.instanceId)).toEqual(['signed-out'])
    expect(sections.hidden.map(item => item.instanceId)).toEqual(['b'])
    expect(stripItems(mixed, { order: ['c'], hidden: ['b'] }).map(item => item.instanceId)).toEqual(['c', 'a'])
  })

  it('moves an account among the shown ones and keeps the remembered rest after them', () => {
    expect(moveAccount({ order: ['x', 'a'], shownIds: ['a', 'b', 'c'], id: 'c', toIndex: 0 })).toEqual(['c', 'a', 'b', 'x'])
    expect(moveAccount({ order: [], shownIds: ['a', 'b', 'c'], id: 'a', toIndex: 1 })).toEqual(['b', 'a', 'c'])
    expect(moveAccount({ order: [], shownIds: ['a', 'b'], id: 'b', toIndex: 9 })).toEqual(['a', 'b'])
  })
})

describe('Luna Reserve meter', () => {
  const reserve = (percentRemaining: number) => ({ label: 'Luna Reserve', percentRemaining, resetsAt: 200 * HOUR, reserve: true })

  it('binds a spent account to its reserve while it lasts, and to the spent limit after', () => {
    expect(bindingWindow(card('codex', [window('Weekly limit', 0, 100 * HOUR), reserve(80)]))).toMatchObject({
      windowLabel: 'Luna Reserve',
      percentRemaining: 80,
      exhausted: false,
      onReserve: true,
    })
    expect(bindingWindow(card('codex', [window('Weekly limit', 0, 100 * HOUR), reserve(0)]))).toMatchObject({
      windowLabel: 'Weekly limit',
      exhausted: true,
      onReserve: false,
    })
  })

  it('ignores the reserve while the ordinary limit has room, so it never replaces a fresh gauge', () => {
    expect(bindingWindow(card('codex', [window('Weekly limit', 100, 100 * HOUR), reserve(5)]))).toMatchObject({
      windowLabel: 'Weekly limit',
      percentRemaining: 100,
      onReserve: false,
    })
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
