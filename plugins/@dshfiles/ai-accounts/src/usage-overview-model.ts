import type { AccountKind, AccountsUsage, UsageCard } from './api.js'
import { AccountDraftModel } from './account-draft.js'
import { KIND_GROUPS } from './account-labels.js'

/**
 * What the usage strip and popover show: saved accounts, including disabled accounts and those
 * without quota data, filtered by provider tab and arranged by the user. Windows stay in
 * session → weekly → monthly order. Pure so the footer, the edge overlay and
 * the tests read it one way.
 */

export type ProviderTab = 'all' | AccountKind

export type OverviewCard = AccountsUsage['cards'][number]

type UsageWindow = OverviewCard['usage']['windows'][number]

/** Where the user arranged the usage surfaces: one order and one hidden list, shared by the strip and the popover. */
export interface UsageLayout {
  readonly order: readonly string[]
  readonly hidden: readonly string[]
}

export interface QuotaSummaryItem {
  readonly instanceId: string
  readonly displayName: string
  /** The account's tag on narrow surfaces ("CA", "EM"): its picker tag, or its initials. */
  readonly shortName: string
  readonly kind: AccountKind
  readonly windowLabel: string
  readonly percentRemaining: number
  readonly resetsAt: number | null
  readonly exhausted: boolean
  /** The ordinary limit is spent and requests draw on Luna Reserve. */
  readonly onReserve: boolean
  readonly disabled?: boolean
  readonly windows?: readonly UsageWindow[]
}

export interface UnavailableSummaryItem {
  readonly instanceId: string
  readonly displayName: string
  readonly shortName: string
  readonly kind: AccountKind
  readonly unavailable: { readonly label: string; readonly reason: string }
  readonly disabled?: boolean
}

export type AccountSummaryItem = QuotaSummaryItem | UnavailableSummaryItem

export const SHORT_NAME_MAX_LENGTH = 6

/** At or below this much left an account turns warning amber; colour stays off a healthy account. */
export const LOW_QUOTA_PERCENT = 15

const windowRank = (label: string): number => {
  const lower = label.toLowerCase()
  if (lower.includes('session')) return 0
  if (lower === 'weekly limit') return 1
  if (lower.includes('week')) return 2
  if (lower.includes('month')) return 3
  return 4
}

const arrange = <Item extends { readonly instanceId: string }>(items: readonly Item[], order: readonly string[]): Item[] => {
  const rank = (id: string): number => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return [...items].sort((left, right) => rank(left.instanceId) - rank(right.instanceId))
}

const hasQuota = (card: OverviewCard): boolean => card.usage.status === 'ok' && card.usage.windows.length > 0

const resetOrder = (resetsAt: number | null): number => resetsAt ?? Number.POSITIVE_INFINITY

/** A sidebar meter's two lines: the percent left and the reset in words; either may be hidden. */
export interface MeterLines {
  readonly percent: string | null
  readonly reset: string | null
}

/** The status-line segments that fit inline, and the rest for the overflow menu. */
export interface SegmentSplit {
  readonly inline: readonly AccountSummaryItem[]
  readonly overflow: readonly AccountSummaryItem[]
}

/** How many segments fit, and whether they all keep their reset times or only the urgent ones do. */
export interface SegmentFit {
  readonly count: number
  readonly resets: 'all' | 'urgent'
}

export class UsageOverviewModel {
  static sortWindows = <Window extends { readonly label: string }>(windows: readonly Window[]): Window[] =>
    [...windows].sort((left, right) => windowRank(left.label) - windowRank(right.label))

  /** Provider tabs in rail order, for kinds with a saved account. */
  static overviewProviders = (usage: AccountsUsage | null): AccountKind[] => KIND_GROUPS.filter(kind => usage?.cards.some(card => card.kind === kind) ?? false)

  /** A window whose rounded percent left is 0: requests fail until it resets. */
  static isExhausted = (percentRemaining: number): boolean => Math.round(percentRemaining) <= 0

  /** Luna Reserve only counts once an ordinary window is spent; until then it is an extra meter. */
  static reserveInUse = (windows: readonly UsageWindow[]): UsageWindow | undefined =>
    windows.some(window => window.reserve !== true && UsageOverviewModel.isExhausted(window.percentRemaining))
      ? windows.find(window => window.reserve === true && !UsageOverviewModel.isExhausted(window.percentRemaining))
      : undefined

  /** An ordinary window is spent and no reserve is left to fall back on. */
  static isCardLimited = (windows: readonly UsageWindow[]): boolean =>
    windows.some(window => window.reserve !== true && UsageOverviewModel.isExhausted(window.percentRemaining)) &&
    UsageOverviewModel.reserveInUse(windows) === undefined

  /**
   * Saved cards for the tab, split three ways: the ones with quota to show
   * (in canonical account priority), the ones without
   * quota data (signed out, failing), and the ones the user hid.
   */
  static overviewSections = (
    usage: AccountsUsage | null,
    tab: ProviderTab,
    layout: UsageLayout,
  ): { readonly cards: OverviewCard[]; readonly unavailable: OverviewCard[]; readonly hidden: OverviewCard[] } => {
    const accounts = (usage?.cards ?? []).filter(card => tab === 'all' || card.kind === tab)
    const visible = accounts.filter(card => !layout.hidden.includes(card.instanceId))
    const cards = visible.filter(hasQuota).map(card => ({ ...card, usage: { ...card.usage, windows: UsageOverviewModel.sortWindows(card.usage.windows) } }))
    return {
      cards: arrange(cards, layout.order),
      unavailable: arrange(
        visible.filter(card => !hasQuota(card)),
        layout.order,
      ),
      hidden: arrange(
        accounts.filter(card => layout.hidden.includes(card.instanceId)),
        layout.order,
      ),
    }
  }

  /** The name the usage strip shows beside an account's meter: its strip override, then its picker tag, then its initials. */
  static stripShortName = (input: { readonly displayName: string; readonly tag: string; readonly override: string | undefined }): string =>
    (input.override ?? '').trim().slice(0, SHORT_NAME_MAX_LENGTH) || input.tag.trim() || AccountDraftModel.badgeFromName(input.displayName)

  /**
   * The window that limits an account. Among spent windows, the one that resets
   * last, since the account stays blocked until then; otherwise the lowest
   * percent left, the sooner reset breaking a tie.
   */
  static bindingWindow = (card: OverviewCard): QuotaSummaryItem | undefined => {
    if (card.usage.status !== 'ok') return undefined
    const reserve = UsageOverviewModel.reserveInUse(card.usage.windows)
    if (reserve !== undefined) {
      return {
        instanceId: card.instanceId,
        displayName: card.displayName,
        shortName: AccountDraftModel.badgeFromName(card.displayName),
        kind: card.kind,
        windowLabel: reserve.label,
        percentRemaining: Math.max(0, reserve.percentRemaining),
        resetsAt: reserve.resetsAt,
        exhausted: false,
        onReserve: true,
        windows: UsageOverviewModel.sortWindows(card.usage.windows),
      }
    }
    const ordinary = card.usage.windows.filter(window => window.reserve !== true)
    const spent = ordinary.filter(window => UsageOverviewModel.isExhausted(window.percentRemaining))
    const candidates = spent.length > 0 ? spent : ordinary
    const binding = [...candidates].sort((left, right) =>
      spent.length > 0
        ? resetOrder(right.resetsAt) - resetOrder(left.resetsAt)
        : left.percentRemaining - right.percentRemaining || resetOrder(left.resetsAt) - resetOrder(right.resetsAt),
    )[0]
    if (binding === undefined) return undefined
    return {
      instanceId: card.instanceId,
      displayName: card.displayName,
      shortName: AccountDraftModel.badgeFromName(card.displayName),
      kind: card.kind,
      windowLabel: binding.label,
      percentRemaining: Math.max(0, binding.percentRemaining),
      resetsAt: binding.resetsAt,
      exhausted: spent.length > 0,
      onReserve: false,
      windows: UsageOverviewModel.sortWindows(card.usage.windows),
    }
  }

  /** Account visibility depends only on explicit hide preferences, never the quota endpoint's availability. */
  static visibleCards = (usage: AccountsUsage | null, tab: ProviderTab, layout: UsageLayout): OverviewCard[] =>
    arrange(
      (usage?.cards ?? []).filter(card => !layout.hidden.includes(card.instanceId) && (tab === 'all' || card.kind === tab)),
      layout.order,
    )

  static unavailableStatus = (card: OverviewCard): UnavailableSummaryItem['unavailable'] => ({
    label: card.usage.status === 'unauthenticated' ? 'Sign in again' : 'Quota unavailable',
    reason:
      card.usage.message ??
      (card.usage.status === 'ok'
        ? card.usage.windows.length === 0
          ? 'No quota windows reported.'
          : 'No ordinary quota window reported.'
        : 'Usage is not available.'),
  })

  /** Preserve every visible saved account; absent quota must not invent a numeric meter. */
  static stripItems = (usage: AccountsUsage | null, layout: UsageLayout): AccountSummaryItem[] =>
    UsageOverviewModel.visibleCards(usage, 'all', layout).map(card => {
      const quota = UsageOverviewModel.bindingWindow(card)
      if (quota !== undefined) return { ...quota, disabled: !card.enabled }
      return {
        instanceId: card.instanceId,
        displayName: card.displayName,
        shortName: AccountDraftModel.badgeFromName(card.displayName),
        kind: card.kind,
        unavailable: UsageOverviewModel.unavailableStatus(card),
        disabled: !card.enabled,
      }
    })

  /** Rank only actual quota measurements, never unavailable accounts as zero or full. */
  static mostCritical = (items: readonly AccountSummaryItem[]): QuotaSummaryItem | undefined =>
    items
      .filter((item): item is QuotaSummaryItem => !('unavailable' in item) && item.disabled !== true)
      .sort((left, right) => left.percentRemaining - right.percentRemaining || resetOrder(left.resetsAt) - resetOrder(right.resetsAt))[0]

  /** "4d 12h", "1h 11m", "9m", "now", or null without a known reset. */
  static formatResetShort = (resetsAt: number | null, now: number): string | null => {
    if (resetsAt === null || !Number.isFinite(resetsAt)) return null
    const remaining = resetsAt - now
    if (remaining <= 0) return 'now'
    const minutes = Math.floor(remaining / 60_000)
    const days = Math.floor(minutes / 1_440)
    if (days > 0) return `${String(days)}d ${String(Math.floor((minutes % 1_440) / 60))}h`
    if (minutes >= 60) return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
    return `${String(Math.max(1, minutes))}m`
  }

  /**
   * The lines of one sidebar meter for the chosen label. A meter never goes
   * blank: asking for the reset alone falls back to the percent while no reset
   * is known. Every quota surface says what is left ("51% left"), never a bare
   * percent, and the reset in words ("resets in 2 h"), never a glyph.
   */
  static meterLines = (item: QuotaSummaryItem, now: number, label: 'both' | 'percent' | 'reset'): MeterLines => {
    // The sidebar meter is a narrow two-line card, so its reset keeps the short units ("resets in 2h 0m").
    const short = UsageOverviewModel.formatResetShort(item.resetsAt, now)
    const reset = short === null || label === 'percent' ? null : short === 'now' ? 'resetting' : `resets in ${short}`
    const percent = item.disabled
      ? `${String(Math.round(item.percentRemaining))}% left`
      : item.exhausted
        ? `${item.shortName} limit reached`
        : UsageOverviewModel.leftText(item)
    return { percent: label === 'reset' && reset !== null ? null : percent, reset }
  }

  /** "1 d 21 h", "2 h 5 min", "9 min", "now", or null without a known reset: the long form tooltips and pages read. */
  static formatResetSpaced = (resetsAt: number | null, now: number): string | null => {
    if (resetsAt === null || !Number.isFinite(resetsAt)) return null
    const remaining = resetsAt - now
    if (remaining <= 0) return 'now'
    const minutes = Math.floor(remaining / 60_000)
    const days = Math.floor(minutes / 1_440)
    if (days > 0) return `${String(days)} d ${String(Math.floor((minutes % 1_440) / 60))} h`
    if (minutes >= 60) return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`
    return `${String(Math.max(1, minutes))} min`
  }

  /** The local weekday and 24-hour clock of a reset ("Thu 03:00"). */
  static resetClock = (resetsAt: number): string => {
    const date = new Date(resetsAt)
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' })
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    return `${weekday} ${clock}`
  }

  /** "Resets in 1 d 21 h · Thu 03:00", "Resetting now", or null without a known reset. */
  static resetLine = (resetsAt: number | null, now: number): string | null => {
    const spaced = UsageOverviewModel.formatResetSpaced(resetsAt, now)
    if (spaced === null || resetsAt === null) return null
    if (spaced === 'now') return 'Resetting now'
    return `Resets in ${spaced} · ${UsageOverviewModel.resetClock(resetsAt)}`
  }

  /** What one account has left, in the one wording every quota surface uses: "51% left", "40% reserve left". */
  static leftText = (item: Pick<QuotaSummaryItem, 'percentRemaining' | 'onReserve'>): string =>
    `${String(Math.round(item.percentRemaining))}% ${item.onReserve ? 'reserve left' : 'left'}`

  /**
   * The status strip's tone for one account (one convention for every quota surface): neutral while healthy, warning at
   * 15% left or less, danger only once the limit is reached (requests fail: a Failed state).
   */
  static stripTone = (item: AccountSummaryItem): 'ok' | 'low' | 'critical' => {
    if ('unavailable' in item || item.disabled === true) return 'ok'
    if (item.exhausted) return 'critical'
    return item.percentRemaining <= LOW_QUOTA_PERCENT ? 'low' : 'ok'
  }

  /**
   * Which accounts the status strip shows as segments and which the `+N` holds (b:hbtt). Every account keeps the
   * user's own order (priority); when not all fit, the open thread's account is kept first, then enabled accounts in
   * order, and accounts that are off (dimmed) fold into `+N` before any enabled one. Pins are an optional filter: once
   * the user pins accounts, only those are segments and the others count in `+N`.
   */
  static stripSegments = (input: {
    readonly items: readonly AccountSummaryItem[]
    readonly pinned?: readonly string[]
    readonly activeId?: string | null
    /** How many segments fit; `Infinity` while the strip is not measured (tests, first paint). */
    readonly capacity: number
  }): SegmentSplit => {
    const pinned = input.pinned ?? []
    const pins = pinned.length === 0 ? [] : input.items.filter(item => pinned.includes(item.instanceId))
    const candidates = pins.length > 0 ? pins : [...input.items]
    const rest = pins.length > 0 ? input.items.filter(item => !pins.includes(item)) : []
    const room = Number.isFinite(input.capacity) ? Math.max(1, Math.floor(input.capacity)) : candidates.length
    if (room >= candidates.length) return { inline: candidates, overflow: rest }
    const chosen = new Set(
      UsageOverviewModel.segmentPriority(candidates, input.activeId ?? null)
        .slice(0, room)
        .map(item => item.instanceId),
    )
    return { inline: candidates.filter(item => chosen.has(item.instanceId)), overflow: [...candidates.filter(item => !chosen.has(item.instanceId)), ...rest] }
  }

  /** The order segments are kept in when not all fit: the thread's account, enabled accounts, then accounts that are off. */
  static segmentPriority = (items: readonly AccountSummaryItem[], activeId: string | null): AccountSummaryItem[] => {
    const active = items.filter(item => item.instanceId === activeId)
    const others = items.filter(item => item.instanceId !== activeId)
    return [...active, ...others.filter(item => item.disabled !== true), ...others.filter(item => item.disabled === true)]
  }

  /**
   * How many segments of the given widths fit in a budget, keeping room for the `+N` chip when some are left out;
   * at least one. A budget of 0 or less with no measured widths means "not measured": every segment shows.
   */
  static fitCount = (widths: readonly number[], budget: number, moreWidth: number, gap = 0): number => {
    if (widths.length === 0) return 0
    if (widths.every(width => width <= 0)) return Number.POSITIVE_INFINITY
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)
    if (total <= budget) return widths.length
    let used = 0
    let count = 0
    for (const width of widths) {
      const next = used + (count === 0 ? 0 : gap) + width
      if (next + gap + moreWidth > budget) break
      used = next
      count += 1
    }
    return Math.max(1, count)
  }

  /**
   * How many accounts the phone pill names before `+N` (b:hbtt): the pill is text, at most `min(80vw, 320px)` wide, so
   * this counts characters at 6.5 px each (12 px Geist with tabular figures measures about 6.2). At least three.
   */
  static pillCount = (texts: readonly string[], viewportWidth: number): number => {
    const CHAR = 6.5
    const chip = Math.min(viewportWidth * 0.8, 320)
    // The pill's padding and dot, and the "+N" that follows a cut list.
    const budget = chip - 36 - 3 * CHAR
    let used = 0
    let count = 0
    for (const text of texts) {
      const next = used + (count === 0 ? 0 : 3 * CHAR) + text.length * CHAR
      if (next > budget) break
      used = next
      count += 1
    }
    return Math.min(texts.length, Math.max(3, count))
  }

  /** One segment's words (b:hbtt): "51%" (what is left), "limit" once reached, "off", "sign in", or "–" without a reading. */
  static segmentWords = (item: AccountSummaryItem): string => {
    if (item.disabled === true) return 'off'
    if ('unavailable' in item) return item.unavailable.label === 'Sign in again' ? 'sign in' : '–'
    if (item.exhausted) return 'limit'
    return `${String(Math.round(item.percentRemaining))}%`
  }

  /**
   * The compact reset after a segment's words (b:jaz6): "1d 21h", "3h 12m", "12m", or null when the account is off,
   * reports no reading or no known reset, or its reset is already due (the next reading replaces it).
   */
  static segmentReset = (item: AccountSummaryItem, now: number): string | null => {
    if ('unavailable' in item || item.disabled === true) return null
    const short = UsageOverviewModel.formatResetShort(item.resetsAt, now)
    return short === null || short === 'now' ? null : short
  }

  /** Whether a segment keeps its reset when room runs short: at the limit or at 15% left or less (b:jaz6). */
  static resetMatters = (item: AccountSummaryItem): boolean => UsageOverviewModel.stripTone(item) !== 'ok'

  /**
   * How many segments fit and which keep their reset time (b:jaz6). Widths are in keep order
   * ({@link segmentPriority}), each with (`full`) and without (`bare`) its reset; an account without a reset has equal
   * widths. Resets go first from healthy accounts, kept on limited and low ones; only then does `+N` take accounts.
   */
  static segmentPlan = (input: {
    readonly full: readonly number[]
    readonly bare: readonly number[]
    readonly urgent: readonly boolean[]
    readonly budget: number
    readonly moreWidth: number
    readonly gap?: number
  }): SegmentFit => {
    const gap = input.gap ?? 0
    const all = UsageOverviewModel.fitCount(input.full, input.budget, input.moreWidth, gap)
    if (all >= input.full.length) return { count: all, resets: 'all' }
    const mixed = input.bare.map((width, index) => (input.urgent[index] === true ? (input.full[index] ?? width) : width))
    return { count: UsageOverviewModel.fitCount(mixed, input.budget, input.moreWidth, gap), resets: 'urgent' }
  }

  /**
   * One window in a segment's tooltip (b:jaz6): "Weekly limit: 51% left · resets in 1 d 21 h · Thu 03:00", the same
   * spaced units as the Usage page; "limit reached" once spent, and no reset part without a known reset.
   */
  static windowTooltipLine = (window: Pick<UsageWindow, 'label' | 'percentRemaining' | 'resetsAt'>, now: number): string => {
    const left = UsageOverviewModel.isExhausted(window.percentRemaining) ? 'limit reached' : `${String(Math.round(window.percentRemaining))}% left`
    const reset = UsageOverviewModel.resetLine(window.resetsAt, now)
    return `${window.label}: ${left}${reset === null ? '' : ` · ${reset.charAt(0).toLowerCase()}${reset.slice(1)}`}`
  }

  /** Pin or unpin one account for the status strip; pins filter which accounts it shows (no cap). */
  static togglePinned = (pinned: readonly string[], id: string): string[] => (pinned.includes(id) ? pinned.filter(entry => entry !== id) : [...pinned, id])

  /**
   * The popover's order from the status strip (b:4v6p): accounts grouped by provider, the provider with the most
   * constrained account first, and inside a group the least remaining first; accounts that are off or report no
   * quota close each group.
   */
  static byRemaining = (cards: readonly OverviewCard[]): OverviewCard[] => {
    const remaining = (card: OverviewCard): number => {
      if (!card.enabled) return Number.POSITIVE_INFINITY
      return UsageOverviewModel.bindingWindow(card)?.percentRemaining ?? Number.MAX_VALUE
    }
    const groupLow = new Map<string, number>()
    for (const card of cards) groupLow.set(card.kind, Math.min(groupLow.get(card.kind) ?? Number.POSITIVE_INFINITY, remaining(card)))
    const groups = [...groupLow.entries()].sort((left, right) => left[1] - right[1]).map(([kind]) => kind)
    return groups.flatMap(kind => cards.filter(card => card.kind === kind).sort((left, right) => remaining(left) - remaining(right)))
  }

  /** "Resets in 1 h 11 min", "Resets in 5 d 20 h", or a plain fallback. */
  static formatResetIn = (resetsAt: number | null, now: number): string => {
    const spaced = UsageOverviewModel.formatResetSpaced(resetsAt, now)
    if (spaced === null) return 'Reset time unavailable'
    return spaced === 'now' ? 'Resetting now' : `Resets in ${spaced}`
  }

  /** How long ago a reading was taken: "just now", "9m ago", "1h 11m ago", "2d ago". */
  static formatReadAge = (readAt: number, now: number): string => {
    const minutes = Math.floor((now - readAt) / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${String(minutes)}m ago`
    if (minutes < 1_440) return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m ago`
    return `${String(Math.floor(minutes / 1_440))}d ago`
  }

  /** When a card's content was read; a Host older than per-card read times only knows its sweep. */
  static cardReadAt = (usage: UsageCard, sweepReadAt: number): number => usage.readAt ?? sweepReadAt

  /** "Next reading in 4m" while the Host holds reads back, so a refresh that changes nothing explains itself. */
  static nextReading = (usage: UsageCard, now: number): string | null => {
    if (usage.nextReadAt === undefined || usage.nextReadAt <= now) return null
    return `Next reading in ${UsageOverviewModel.formatResetShort(usage.nextReadAt, now) ?? 'a moment'}`
  }

  /** Why a card shows an older reading than the latest read attempt, or null when it does not. */
  static readFailureReason = (usage: UsageCard): string | null =>
    usage.readFailure === undefined ? null : (usage.readFailure.message ?? 'The provider did not return usage.')

  /** Every shown figure is as old as its oldest card. */
  static oldestReadAt = (usage: AccountsUsage): number =>
    Math.min(usage.readAt, ...usage.cards.map(card => UsageOverviewModel.cardReadAt(card.usage, usage.readAt)))

  /** One line for a surface that has no per-card status: which accounts kept an older reading, and why. */
  static staleSummary = (usage: AccountsUsage | null): string | null => {
    const stale = (usage?.cards ?? []).filter(card => card.enabled && card.usage.readFailure !== undefined)
    const [first] = stale
    if (first === undefined) return null
    if (stale.length > 1) return `${String(stale.length)} accounts kept their last reading because a new one failed.`
    return `${first.displayName}: ${UsageOverviewModel.readFailureReason(first.usage) ?? ''}`
  }

  /** Banked reset expiries, soonest first, unknown last. */
  static bankedExpiries = (expiries: readonly (number | null)[]): (number | null)[] =>
    [...expiries].sort((left, right) => (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY))
}
