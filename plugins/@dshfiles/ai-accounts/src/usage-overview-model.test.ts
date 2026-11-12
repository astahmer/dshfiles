import { describe, expect, it } from 'vitest'
import type { AccountsUsage } from './api.js'
import { type AccountSummaryItem, UsageOverviewModel } from './usage-overview-model.js'

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
  it('shows saved providers including disabled accounts, with session before weekly', () => {
    expect(UsageOverviewModel.overviewProviders(usage)).toEqual(['codex', 'commandcode'])
    const cards = UsageOverviewModel.overviewSections(usage, 'all', noLayout).cards
    expect(cards.map(card => card.instanceId)).toEqual(['codex', 'cc'])
    expect(cards[0]?.usage.windows.map(window => window.label)).toEqual(['Current session', 'Weekly limit'])
    expect(UsageOverviewModel.overviewSections(usage, 'commandcode', noLayout).cards.map(card => card.instanceId)).toEqual(['cc'])
    expect(UsageOverviewModel.overviewSections(usage, 'commandcode', noLayout).unavailable).toEqual([])
    expect(UsageOverviewModel.visibleCards(usage, 'all', noLayout).map(card => card.instanceId)).toEqual(['codex', 'cc'])
  })

  it('preserves disabled measurements but ranks only enabled accounts for the collapsed meter', () => {
    expect(UsageOverviewModel.stripItems(usage, noLayout).map(item => [item.instanceId, 'unavailable' in item ? null : item.percentRemaining])).toEqual([
      ['codex', 53],
      ['cc', 5],
    ])
    expect(UsageOverviewModel.bindingWindow(usage.cards[0]!)?.windows?.map(window => [window.label, window.percentRemaining])).toEqual([
      ['Current session', 69],
      ['Weekly limit', 53],
    ])
    expect(UsageOverviewModel.mostCritical(UsageOverviewModel.stripItems(usage, noLayout))?.instanceId).toBe('codex')
    expect(UsageOverviewModel.stripItems(null, noLayout)).toEqual([])
  })

  it('formats resets and ages like the reference footer', () => {
    expect(UsageOverviewModel.formatResetShort((4 * 24 + 12) * 3_600_000, 0)).toBe('4d 12h')
    expect(UsageOverviewModel.formatResetShort(null, 0)).toBeNull()
    expect(UsageOverviewModel.formatResetIn(0 + (1 * 60 + 11) * 60_000 + 30_000, 0)).toBe('Resets in 1 h 11 min')
    expect(UsageOverviewModel.formatResetIn((5 * 24 + 20) * 3_600_000 + 1, 0)).toBe('Resets in 5 d 20 h')
    expect(UsageOverviewModel.formatResetSpaced(9 * 60_000, 0)).toBe('9 min')
    expect(UsageOverviewModel.formatResetIn(10, 20)).toBe('Resetting now')
    expect(UsageOverviewModel.formatReadAge(0, 30_000)).toBe('just now')
    expect(UsageOverviewModel.formatReadAge(0, 4 * 60_000 + 38_000)).toBe('4m ago')
    expect(UsageOverviewModel.formatReadAge(0, 71 * 60_000)).toBe('1h 11m ago')
    expect(UsageOverviewModel.formatReadAge(0, 3 * 24 * 3_600_000)).toBe('3d ago')
    expect(UsageOverviewModel.bankedExpiries([3, null, 1])).toEqual([1, 3, null])
  })

  it('shows percent, reset or both on a meter, never neither', () => {
    const item = {
      instanceId: 'codex',
      displayName: 'Codex',
      shortName: 'CA',
      kind: 'codex',
      windowLabel: 'Weekly',
      percentRemaining: 41.6,
      resetsAt: 2 * 3_600_000,
      exhausted: false,
      onReserve: false,
    } as const
    expect(UsageOverviewModel.meterLines(item, 0, 'both')).toEqual({ percent: '42% left', reset: 'resets in 2h 0m' })
    expect(UsageOverviewModel.meterLines(item, 0, 'percent')).toEqual({ percent: '42% left', reset: null })
    expect(UsageOverviewModel.meterLines(item, 0, 'reset')).toEqual({ percent: null, reset: 'resets in 2h 0m' })
    expect(UsageOverviewModel.meterLines({ ...item, resetsAt: null }, 0, 'reset')).toEqual({ percent: '42% left', reset: null })
    expect(UsageOverviewModel.meterLines({ ...item, onReserve: true }, 0, 'percent')).toEqual({ percent: '42% reserve left', reset: null })
    expect(UsageOverviewModel.meterLines({ ...item, exhausted: true }, 3 * 3_600_000, 'both')).toEqual({ percent: 'CA limit reached', reset: 'resetting' })
    expect(UsageOverviewModel.meterLines({ ...item, disabled: true, exhausted: true, percentRemaining: 0 }, 0, 'both')).toEqual({
      percent: '0% left',
      reset: 'resets in 2h 0m',
    })
  })

  it('says when a reset happens in words and on the clock, never with a glyph', () => {
    const resetsAt = new Date(2026, 10, 12, 3, 0).getTime()
    const now = resetsAt - (45 * 60 + 30) * 60_000
    const line = UsageOverviewModel.resetLine(resetsAt, now)
    expect(line).toMatch(/^Resets in 1 d 21 h · \S+ 03:00$/)
    expect(UsageOverviewModel.resetLine(null, now)).toBeNull()
    expect(UsageOverviewModel.resetLine(now - 1, now)).toBe('Resetting now')
  })

  it('colours only a near or reached limit', () => {
    const base = { instanceId: 'a', displayName: 'Jarvis', shortName: 'JA', kind: 'codex', windowLabel: 'Weekly', resetsAt: null, onReserve: false } as const
    const healthy = { ...base, percentRemaining: 51, exhausted: false }
    const low = { ...base, instanceId: 'b', displayName: 'Alfred', percentRemaining: 12, exhausted: false }
    const spent = { ...base, instanceId: 'c', displayName: 'Ada', percentRemaining: 0, exhausted: true }
    expect(UsageOverviewModel.stripTone(healthy)).toBe('ok')
    expect(UsageOverviewModel.stripTone({ ...healthy, percentRemaining: 15 })).toBe('low')
    expect(UsageOverviewModel.stripTone(low)).toBe('low')
    expect(UsageOverviewModel.stripTone(spent)).toBe('critical')
    expect(UsageOverviewModel.stripTone({ ...spent, disabled: true })).toBe('ok')
    expect(UsageOverviewModel.leftText(healthy)).toBe('51% left')
    expect(UsageOverviewModel.segmentWords(healthy)).toBe('51%')
    expect(UsageOverviewModel.segmentWords(spent)).toBe('limit')
    expect(UsageOverviewModel.segmentWords({ ...spent, disabled: true })).toBe('off')
  })

  it('shows every enabled account in order, as many as fit, pins as a filter, the thread account kept (b:hbtt)', () => {
    const base = { displayName: 'x', shortName: 'X', kind: 'codex', windowLabel: 'Weekly', resetsAt: null, onReserve: false, exhausted: false } as const
    const six: AccountSummaryItem[] = [
      { ...base, instanceId: 'jarvis', percentRemaining: 51 },
      { ...base, instanceId: 'alfred', percentRemaining: 12 },
      { ...base, instanceId: 'ada', percentRemaining: 0, exhausted: true },
      { ...base, instanceId: 'off', percentRemaining: 3, disabled: true },
      { ...base, instanceId: 'cc1', kind: 'commandcode', percentRemaining: 80 },
      { ...base, instanceId: 'cc2', kind: 'commandcode', percentRemaining: 64 },
    ]
    const ids = (list: readonly AccountSummaryItem[]): string[] => list.map(item => item.instanceId)
    // Unmeasured: every account in the user's order, the one that is off in its place.
    const all = UsageOverviewModel.stripSegments({ items: six, capacity: Number.POSITIVE_INFINITY })
    expect(ids(all.inline)).toEqual(['jarvis', 'alfred', 'ada', 'off', 'cc1', 'cc2'])
    // Five fit: the account that is off folds into +N first.
    const five = UsageOverviewModel.stripSegments({ items: six, capacity: 5 })
    expect(ids(five.inline)).toEqual(['jarvis', 'alfred', 'ada', 'cc1', 'cc2'])
    expect(ids(five.overflow)).toEqual(['off'])
    expect(all.overflow).toHaveLength(0)
    const three = UsageOverviewModel.stripSegments({ items: six, capacity: 3 })
    expect(ids(three.inline)).toEqual(['jarvis', 'alfred', 'ada'])
    expect(ids(three.overflow)).toEqual(['off', 'cc1', 'cc2'])
    // The open thread's account takes the last segment rather than hide in +N.
    const active = UsageOverviewModel.stripSegments({ items: six, capacity: 3, activeId: 'cc2' })
    expect(ids(active.inline)).toEqual(['jarvis', 'alfred', 'cc2'])
    expect(ids(active.overflow)).toEqual(['ada', 'off', 'cc1'])
    // Pins filter: only pinned accounts are segments (in the user's order), the others count in +N.
    const pinned = UsageOverviewModel.stripSegments({ items: six, capacity: 9, pinned: ['cc2', 'alfred', 'off'] })
    expect(ids(pinned.inline)).toEqual(['alfred', 'off', 'cc2'])
    expect(ids(pinned.overflow)).toEqual(['jarvis', 'ada', 'cc1'])
    // A pin that no longer exists shows every account again.
    expect(ids(UsageOverviewModel.stripSegments({ items: six, capacity: 9, pinned: ['gone'] }).inline)).toHaveLength(6)
    // Every account off: they show, so the strip never reads as empty.
    const off = six.map(item => ({ ...item, disabled: true }))
    expect(UsageOverviewModel.stripSegments({ items: off, capacity: 9 }).inline).toHaveLength(6)
    expect(UsageOverviewModel.togglePinned([], 'a')).toEqual(['a'])
    expect(UsageOverviewModel.togglePinned(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(UsageOverviewModel.togglePinned(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('fits segments into the strip and the phone pill (b:hbtt)', () => {
    expect(UsageOverviewModel.fitCount([80, 80, 80], 300, 24, 2)).toBe(3)
    // 80 + 2 + 80 + 2 + 24 = 188 fits, a third would not leave room for +N.
    expect(UsageOverviewModel.fitCount([80, 80, 80], 200, 24, 2)).toBe(2)
    expect(UsageOverviewModel.fitCount([80, 80, 80], 10, 24, 2)).toBe(1)
    expect(UsageOverviewModel.fitCount([0, 0], 0, 0)).toBe(Number.POSITIVE_INFINITY)
    const texts = ['CC1 10%', 'CC2 12%', 'CC3 limit', 'CC4 60%', 'CC6 90%']
    expect(UsageOverviewModel.pillCount(texts, 390)).toBe(4)
    expect(UsageOverviewModel.pillCount(texts, 375)).toBe(3)
    expect(UsageOverviewModel.pillCount(texts, 320)).toBe(3)
    expect(UsageOverviewModel.pillCount(texts.slice(0, 2), 375)).toBe(2)
  })
})

const window = (label: string, percentRemaining: number, resetsAt: number | null) => ({ label, percentRemaining, resetsAt })

const card = (
  instanceId: string,
  windows: AccountsUsage['cards'][number]['usage']['windows'],
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
    expect(UsageOverviewModel.bindingWindow(blocked)).toMatchObject({
      windowLabel: 'Weekly limit',
      percentRemaining: 0.3,
      resetsAt: 100 * HOUR,
      exhausted: true,
    })
  })

  it('binds a usable account to its lowest window, the sooner reset breaking a tie', () => {
    const usable = card('usable', [window('Weekly limit', 20, 50 * HOUR), window('Current session', 20, 3 * HOUR), window('Monthly', 80, HOUR)])
    expect(UsageOverviewModel.bindingWindow(usable)).toMatchObject({ windowLabel: 'Current session', resetsAt: 3 * HOUR, exhausted: false })
    expect(UsageOverviewModel.bindingWindow(card('off', [window('Weekly limit', 0, null)], { enabled: false }))).toMatchObject({
      percentRemaining: 0,
      resetsAt: null,
    })
    expect(UsageOverviewModel.bindingWindow({ ...usable, usage: { ...usable.usage, status: 'unauthenticated' } })).toBeUndefined()
  })

  it('orders the status strip popover by provider, least left first, accounts that are off last (b:4v6p)', () => {
    const cards = [
      card('jarvis', [window('Weekly limit', 51, HOUR)]),
      card('cc1', [window('Weekly limit', 80, HOUR)], { kind: 'commandcode' }),
      card('alfred', [window('Weekly limit', 12, HOUR)]),
      card('off', [window('Weekly limit', 1, HOUR)], { enabled: false }),
      card('cc2', [window('Weekly limit', 5, HOUR)], { kind: 'commandcode' }),
      card('ada', [window('Weekly limit', 0, HOUR)]),
    ]
    expect(UsageOverviewModel.byRemaining(cards).map(entry => entry.instanceId)).toEqual(['ada', 'alfred', 'jarvis', 'off', 'cc2', 'cc1'])
  })

  it('points a narrow surface at the most critical account', () => {
    const items = UsageOverviewModel.stripItems(
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
    expect(items.map(item => item.instanceId)).toEqual(['roomy', 'spent', 'low'])
    expect(UsageOverviewModel.mostCritical(items)?.instanceId).toBe('spent')
  })

  it('never sinks an exhausted account below a lower-priority account', () => {
    const both: AccountsUsage = {
      readAt: 0,
      hostName: 'mac',
      cards: [card('spent', [window('Weekly limit', 0, HOUR)]), card('usable', [window('Weekly limit', 40, HOUR)])],
    }
    expect(UsageOverviewModel.overviewSections(both, 'all', noLayout).cards.map(item => item.instanceId)).toEqual(['spent', 'usable'])
    expect(UsageOverviewModel.overviewSections(both, 'all', { order: ['spent'], hidden: [] }).cards.map(item => item.instanceId)).toEqual(['spent', 'usable'])
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

  it('keeps accounts without quota visible while respecting explicit hiding', () => {
    const sections = UsageOverviewModel.overviewSections(mixed, 'all', { order: [], hidden: ['b', 'gone'] })
    expect(sections.cards.map(item => item.instanceId)).toEqual(['a', 'c'])
    expect(sections.unavailable.map(item => item.instanceId)).toEqual(['signed-out'])
    expect(sections.hidden.map(item => item.instanceId)).toEqual(['b'])
    expect(UsageOverviewModel.stripItems(mixed, { order: ['c'], hidden: ['b'] }).map(item => item.instanceId)).toEqual(['c', 'a', 'signed-out'])
  })

  it('uses the canonical account order even when the quota sweep still has the earlier order', () => {
    const layout = { order: ['c', 'signed-out', 'b', 'a'], hidden: ['b'] }
    expect(UsageOverviewModel.overviewSections(mixed, 'all', layout).cards.map(item => item.instanceId)).toEqual(['c', 'a'])
    expect(UsageOverviewModel.stripItems(mixed, layout).map(item => item.instanceId)).toEqual(['c', 'signed-out', 'a'])
    expect(UsageOverviewModel.visibleCards(mixed, 'all', layout).map(item => item.instanceId)).toEqual(['c', 'signed-out', 'a'])
    expect(UsageOverviewModel.overviewSections(mixed, 'all', layout).unavailable.map(item => item.instanceId)).toEqual(['signed-out'])
  })
})

describe('unavailable quota identity', () => {
  it.each(['unauthenticated', 'unsupported', 'error', 'rate-limited', 'ok'] as const)(
    'preserves an enabled %s account without fabricating measurements',
    status => {
      const missing = card('Example', [], {
        usage: { status, message: 'Provider quota unavailable.', identity: null, plan: null, windows: [], bankedResets: 0, bankedResetExpiries: [] },
      })
      const snapshot = { readAt: 0, hostName: 'test', cards: [missing] }
      const items = UsageOverviewModel.stripItems(snapshot, noLayout)
      expect(items).toEqual([
        {
          instanceId: 'Example',
          displayName: 'Example',
          shortName: 'E',
          kind: 'codex',
          disabled: false,
          unavailable: { label: status === 'unauthenticated' ? 'Sign in again' : 'Quota unavailable', reason: 'Provider quota unavailable.' },
        },
      ])
      expect(UsageOverviewModel.mostCritical(items)).toBeUndefined()
      expect(UsageOverviewModel.stripItems(snapshot, { order: [], hidden: ['Example'] })).toEqual([])
    },
  )

  it('does not drop a reserve-only account without a binding measurement', () => {
    const onlyReserve = card('reserve-only', [{ label: 'Luna Reserve', percentRemaining: 80, resetsAt: HOUR, reserve: true }])
    const items = UsageOverviewModel.stripItems({ readAt: 0, hostName: 'test', cards: [onlyReserve] }, noLayout)
    expect(items[0]).toHaveProperty('unavailable.reason', 'No ordinary quota window reported.')
    expect(UsageOverviewModel.mostCritical(items)).toBeUndefined()
    const withQuota = UsageOverviewModel.stripItems(
      { readAt: 0, hostName: 'test', cards: [onlyReserve, card('low', [window('Weekly limit', 20, HOUR)]), card('high', [window('Weekly limit', 80, HOUR)])] },
      noLayout,
    )
    expect(UsageOverviewModel.mostCritical(withQuota)?.instanceId).toBe('low')
  })
})

describe('Luna Reserve meter', () => {
  const reserve = (percentRemaining: number) => ({ label: 'Luna Reserve', percentRemaining, resetsAt: 200 * HOUR, reserve: true })

  it('binds a spent account to its reserve while it lasts, and to the spent limit after', () => {
    expect(UsageOverviewModel.bindingWindow(card('codex', [window('Weekly limit', 0, 100 * HOUR), reserve(80)]))).toMatchObject({
      windowLabel: 'Luna Reserve',
      percentRemaining: 80,
      exhausted: false,
      onReserve: true,
    })
    expect(UsageOverviewModel.bindingWindow(card('codex', [window('Weekly limit', 0, 100 * HOUR), reserve(0)]))).toMatchObject({
      windowLabel: 'Weekly limit',
      exhausted: true,
      onReserve: false,
    })
  })

  it('ignores the reserve while the ordinary limit has room, so it never replaces a fresh gauge', () => {
    expect(UsageOverviewModel.bindingWindow(card('codex', [window('Weekly limit', 100, 100 * HOUR), reserve(5)]))).toMatchObject({
      windowLabel: 'Weekly limit',
      percentRemaining: 100,
      onReserve: false,
    })
  })
})

describe('strip short names', () => {
  it('prefers the strip override, then the picker tag, then the initials', () => {
    expect(UsageOverviewModel.stripShortName({ displayName: 'Claude Max', tag: 'CM', override: ' work ' })).toBe('work')
    expect(UsageOverviewModel.stripShortName({ displayName: 'Claude Max', tag: 'CM', override: '  ' })).toBe('CM')
    expect(UsageOverviewModel.stripShortName({ displayName: 'Claude Max', tag: '', override: undefined })).toBe('CM')
  })

  it('cuts an override to six characters so one account cannot widen the strip', () => {
    expect(UsageOverviewModel.stripShortName({ displayName: 'Codex', tag: '', override: 'personal-account' })).toBe('person')
  })
})

describe('status-bar reset times (b:jaz6)', () => {
  const MINUTE = 60_000
  it('formats compact units, minutes under an hour, nothing once due', () => {
    const item = (resetsAt: number | null, extra: Partial<AccountSummaryItem> = {}): AccountSummaryItem =>
      ({
        instanceId: 'a',
        displayName: 'A',
        shortName: 'A',
        kind: 'codex',
        windowLabel: 'Weekly limit',
        percentRemaining: 51,
        resetsAt,
        exhausted: false,
        onReserve: false,
        ...extra,
      }) as AccountSummaryItem
    expect(UsageOverviewModel.segmentReset(item((45 * 60 + 30) * MINUTE), 0)).toBe('1d 21h')
    expect(UsageOverviewModel.segmentReset(item((3 * 60 + 12) * MINUTE + 59_000), 0)).toBe('3h 12m')
    expect(UsageOverviewModel.segmentReset(item(12 * MINUTE + 5_000), 0)).toBe('12m')
    expect(UsageOverviewModel.segmentReset(item(20_000), 0)).toBe('1m')
    expect(UsageOverviewModel.segmentReset(item(0), 10)).toBeNull()
    expect(UsageOverviewModel.segmentReset(item(null), 0)).toBeNull()
    expect(UsageOverviewModel.segmentReset(item(HOUR, { disabled: true }), 0)).toBeNull()
  })

  it('shows the window that binds: lowest left, and its own reset', () => {
    const both = card('both', [window('Current session', 75, HOUR), window('Weekly limit', 51, 45 * HOUR)])
    const item = UsageOverviewModel.stripItems({ readAt: 0, hostName: 'h', cards: [both] }, { order: [], hidden: [] })[0]
    expect(item).toMatchObject({ windowLabel: 'Weekly limit', percentRemaining: 51 })
    if (item === undefined) throw new Error('no item')
    expect(UsageOverviewModel.segmentReset(item, 0)).toBe('1d 21h')
    const spent = card('spent', [window('Current session', 0, (2 * 60 + 40) * MINUTE), window('Weekly limit', 40, 45 * HOUR)])
    const limited = UsageOverviewModel.stripItems({ readAt: 0, hostName: 'h', cards: [spent] }, { order: [], hidden: [] })[0]
    if (limited === undefined) throw new Error('no item')
    expect(UsageOverviewModel.segmentWords(limited)).toBe('limit')
    expect(UsageOverviewModel.segmentReset(limited, 0)).toBe('2h 40m')
    expect(UsageOverviewModel.resetMatters(limited)).toBe(true)
  })

  it('drops resets from healthy accounts first, then falls back to +N', () => {
    const urgent = [false, true, false, false]
    const full = [130, 130, 130, 130]
    const bare = [90, 90, 90, 90]
    // Everything with its reset fits.
    expect(UsageOverviewModel.segmentPlan({ full, bare, urgent, budget: 600, moreWidth: 24, gap: 2 })).toEqual({ count: 4, resets: 'all' })
    // 90 + 130 + 90 + 90 + 6 = 406: only the low account keeps its reset, every account fits.
    expect(UsageOverviewModel.segmentPlan({ full, bare, urgent, budget: 420, moreWidth: 24, gap: 2 })).toEqual({ count: 4, resets: 'urgent' })
    // Not even that: +N, the low account still keeps its reset.
    expect(UsageOverviewModel.segmentPlan({ full, bare, urgent, budget: 300, moreWidth: 24, gap: 2 })).toEqual({ count: 2, resets: 'urgent' })
    // Unmeasured: every segment with its reset.
    expect(UsageOverviewModel.segmentPlan({ full: [0, 0], bare: [0, 0], urgent: [false, false], budget: 0, moreWidth: 0 })).toEqual({
      count: Number.POSITIVE_INFINITY,
      resets: 'all',
    })
  })

  it('lists every window with its own reset in the tooltip', () => {
    const at = new Date(2026, 10, 12, 3, 0).getTime()
    const now = at - (45 * 60 + 30) * MINUTE
    expect(UsageOverviewModel.windowTooltipLine({ label: 'Weekly limit', percentRemaining: 51, resetsAt: at }, now)).toMatch(
      /^Weekly limit: 51% left · resets in 1 d 21 h · \S+ 03:00$/u,
    )
    expect(UsageOverviewModel.windowTooltipLine({ label: 'Current session', percentRemaining: 0, resetsAt: null }, now)).toBe('Current session: limit reached')
  })
})
