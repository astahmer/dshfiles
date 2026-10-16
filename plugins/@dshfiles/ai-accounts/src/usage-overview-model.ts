import type { AccountKind, AccountsUsage } from './api.js'
import { AccountDraftModel } from './account-draft.js'
import { KIND_GROUPS } from './account-labels.js'

/**
 * What the usage strip and popover show: enabled accounts that report quota,
 * filtered by provider tab and arranged by the user, each with its windows in
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
  readonly windows?: readonly UsageWindow[]
}

export const SHORT_NAME_MAX_LENGTH = 6

const windowRank = (label: string): number => {
  const lower = label.toLowerCase()
  if (lower.includes('session')) return 0
  if (lower === 'weekly limit') return 1
  if (lower.includes('week')) return 2
  if (lower.includes('month')) return 3
  return 4
}

const cardExhausted = (card: OverviewCard): boolean => card.usage.status === 'ok' && UsageOverviewModel.isCardLimited(card.usage.windows)

const arrange = <Item extends { readonly instanceId: string }>(items: readonly Item[], order: readonly string[]): Item[] => {
  const rank = (id: string): number => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return [...items].sort((left, right) => rank(left.instanceId) - rank(right.instanceId))
}

const hasQuota = (card: OverviewCard): boolean => card.usage.status === 'ok' && card.usage.windows.length > 0

const resetOrder = (resetsAt: number | null): number => resetsAt ?? Number.POSITIVE_INFINITY

export class UsageOverviewModel {
  static sortWindows = <Window extends { readonly label: string }>(windows: readonly Window[]): Window[] =>
    [...windows].sort((left, right) => windowRank(left.label) - windowRank(right.label))

  /** Provider tabs in rail order, only for kinds with an enabled account. */
  static overviewProviders = (usage: AccountsUsage | null): AccountKind[] =>
    KIND_GROUPS.filter(kind => usage?.cards.some(card => card.enabled && card.kind === kind) ?? false)

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
   * Enabled cards for the tab, split three ways: the ones with quota to show
   * (spent ones below usable ones until the user orders them), the ones without
   * quota data (signed out, failing), and the ones the user hid.
   */
  static overviewSections = (
    usage: AccountsUsage | null,
    tab: ProviderTab,
    layout: UsageLayout,
  ): { readonly cards: OverviewCard[]; readonly unavailable: OverviewCard[]; readonly hidden: OverviewCard[] } => {
    const enabled = (usage?.cards ?? []).filter(card => card.enabled && (tab === 'all' || card.kind === tab))
    const visible = enabled.filter(card => !layout.hidden.includes(card.instanceId))
    const cards = visible
      .filter(hasQuota)
      .map(card => ({ ...card, usage: { ...card.usage, windows: UsageOverviewModel.sortWindows(card.usage.windows) } }))
      .sort((left, right) => Number(cardExhausted(left)) - Number(cardExhausted(right)))
    return {
      cards: arrange(cards, layout.order),
      unavailable: visible.filter(card => !hasQuota(card)),
      hidden: enabled.filter(card => layout.hidden.includes(card.instanceId)),
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
    if (!card.enabled || card.usage.status !== 'ok') return undefined
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

  /** The usage strip: each visible account's binding window, in the popover's order. */
  static stripItems = (usage: AccountsUsage | null, layout: UsageLayout): QuotaSummaryItem[] =>
    UsageOverviewModel.overviewSections(usage, 'all', layout).cards.flatMap(card => UsageOverviewModel.bindingWindow(card) ?? [])

  /** The one item a narrow surface shows: the lowest percent left, the sooner reset breaking a tie. */
  static mostCritical = (items: readonly QuotaSummaryItem[]): QuotaSummaryItem | undefined =>
    [...items].sort((left, right) => left.percentRemaining - right.percentRemaining || resetOrder(left.resetsAt) - resetOrder(right.resetsAt))[0]

  /**
   * Moves `id` to `toIndex` among the ids a surface shows, and keeps the
   * remembered position of every id it does not show (hidden, signed out,
   * another tab) after them.
   */
  static moveAccount = (input: {
    readonly order: readonly string[]
    readonly shownIds: readonly string[]
    readonly id: string
    readonly toIndex: number
  }): string[] => {
    const others = input.shownIds.filter(id => id !== input.id)
    const index = Math.max(0, Math.min(others.length, input.toIndex))
    const shown = [...others.slice(0, index), input.id, ...others.slice(index)]
    return [...shown, ...input.order.filter(id => !shown.includes(id))]
  }

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
   * is known.
   */
  static meterLines = (
    item: QuotaSummaryItem,
    now: number,
    label: 'both' | 'percent' | 'reset',
  ): { readonly percent: string | null; readonly reset: string | null } => {
    const short = UsageOverviewModel.formatResetShort(item.resetsAt, now)
    const reset = short === null || label === 'percent' ? null : short === 'now' ? 'resetting' : `↻ ${short}`
    const percent = item.exhausted ? `${item.shortName} limit reached` : `${item.onReserve ? '☾ ' : ''}${String(Math.round(item.percentRemaining))}%`
    return { percent: label === 'reset' && reset !== null ? null : percent, reset }
  }

  /** "Resets in 1h 11m", "Resets in 5d 20h", or a plain fallback. */
  static formatResetIn = (resetsAt: number | null, now: number): string => {
    const short = UsageOverviewModel.formatResetShort(resetsAt, now)
    if (short === null) return 'Reset time unavailable'
    return short === 'now' ? 'Resetting now' : `Resets in ${short}`
  }

  /** Snapshot age as hh:mm:ss, the reference footer's ticking clock. */
  static formatAge = (readAt: number, now: number): string => {
    const seconds = Math.max(0, Math.floor((now - readAt) / 1000))
    const pad = (value: number): string => String(value).padStart(2, '0')
    return `${pad(Math.floor(seconds / 3_600))}:${pad(Math.floor((seconds % 3_600) / 60))}:${pad(seconds % 60)}`
  }

  /** Banked reset expiries, soonest first, unknown last. */
  static bankedExpiries = (expiries: readonly (number | null)[]): (number | null)[] =>
    [...expiries].sort((left, right) => (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY))
}
