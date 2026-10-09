import type { AccountKind, AccountsUsage } from './api.js'
import { KIND_GROUPS } from './account-labels.js'

/**
 * What the usage popover shows: enabled accounts that report quota, filtered
 * by provider tab, each with its windows in session → weekly → monthly order.
 * Pure so the footer, the edge overlay and the tests read it one way.
 */

export type ProviderTab = 'all' | AccountKind

export type OverviewCard = AccountsUsage['cards'][number]

const windowRank = (label: string): number => {
  const lower = label.toLowerCase()
  if (lower.includes('session')) return 0
  if (lower === 'weekly limit') return 1
  if (lower.includes('week')) return 2
  if (lower.includes('month')) return 3
  return 4
}

export const sortWindows = <Window extends { readonly label: string }>(windows: readonly Window[]): Window[] =>
  [...windows].sort((left, right) => windowRank(left.label) - windowRank(right.label))

/** Provider tabs in rail order, only for kinds with an enabled account. */
export const overviewProviders = (usage: AccountsUsage | null): AccountKind[] =>
  KIND_GROUPS.filter(kind => usage?.cards.some(card => card.enabled && card.kind === kind) ?? false)

/** A window whose rounded percent left is 0: requests fail until it resets. */
export const isExhausted = (percentRemaining: number): boolean => Math.round(percentRemaining) <= 0

const cardExhausted = (card: OverviewCard): boolean => card.usage.status === 'ok' && card.usage.windows.some(window => isExhausted(window.percentRemaining))

/** Enabled cards for the tab; accounts with a spent window sink below the usable ones. */
export const overviewCards = (usage: AccountsUsage | null, tab: ProviderTab): OverviewCard[] =>
  (usage?.cards ?? [])
    .filter(card => card.enabled && (tab === 'all' || card.kind === tab))
    .map(card => ({ ...card, usage: { ...card.usage, windows: sortWindows(card.usage.windows) } }))
    .sort((left, right) => Number(cardExhausted(left)) - Number(cardExhausted(right)))

export interface QuotaSummaryItem {
  readonly instanceId: string
  readonly displayName: string
  readonly kind: AccountKind
  readonly windowLabel: string
  readonly percentRemaining: number
  readonly resetsAt: number | null
  readonly exhausted: boolean
}

const resetOrder = (resetsAt: number | null): number => resetsAt ?? Number.POSITIVE_INFINITY

/**
 * The window that limits an account. Among spent windows, the one that resets
 * last, since the account stays blocked until then; otherwise the lowest
 * percent left, the sooner reset breaking a tie.
 */
export const bindingWindow = (card: OverviewCard): QuotaSummaryItem | undefined => {
  if (!card.enabled || card.usage.status !== 'ok') return undefined
  const spent = card.usage.windows.filter(window => isExhausted(window.percentRemaining))
  const candidates = spent.length > 0 ? spent : card.usage.windows
  const binding = [...candidates].sort((left, right) =>
    spent.length > 0
      ? resetOrder(right.resetsAt) - resetOrder(left.resetsAt)
      : left.percentRemaining - right.percentRemaining || resetOrder(left.resetsAt) - resetOrder(right.resetsAt),
  )[0]
  if (binding === undefined) return undefined
  return {
    instanceId: card.instanceId,
    displayName: card.displayName,
    kind: card.kind,
    windowLabel: binding.label,
    percentRemaining: Math.max(0, binding.percentRemaining),
    resetsAt: binding.resetsAt,
    exhausted: spent.length > 0,
  }
}

/**
 * What the footer button shows: the chosen accounts' binding windows, most
 * critical first (lowest percent, then soonest reset), cut to `maxItems`. An
 * empty `accountIds` means every enabled account; ids that no longer exist are
 * ignored, so a stale pick falls back to all rather than to nothing.
 */
export const footerSummary = (input: {
  readonly usage: AccountsUsage | null
  readonly accountIds: readonly string[]
  readonly maxItems: number
}): { readonly shown: readonly QuotaSummaryItem[]; readonly hidden: readonly QuotaSummaryItem[] } => {
  const all = (input.usage?.cards ?? []).flatMap(card => bindingWindow(card) ?? [])
  const picked = all.filter(item => input.accountIds.includes(item.instanceId))
  const ranked = (picked.length > 0 ? picked : all).sort(
    (left, right) => left.percentRemaining - right.percentRemaining || resetOrder(left.resetsAt) - resetOrder(right.resetsAt),
  )
  const limit = Math.max(1, Math.floor(input.maxItems))
  return { shown: ranked.slice(0, limit), hidden: ranked.slice(limit) }
}

/** "4d 12h", "1h 11m", "9m", "now", or null without a known reset. */
export const formatResetShort = (resetsAt: number | null, now: number): string | null => {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null
  const remaining = resetsAt - now
  if (remaining <= 0) return 'now'
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1_440)
  if (days > 0) return `${String(days)}d ${String(Math.floor((minutes % 1_440) / 60))}h`
  if (minutes >= 60) return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
  return `${String(Math.max(1, minutes))}m`
}

/** "Resets in 1h 11m", "Resets in 5d 20h", or a plain fallback. */
export const formatResetIn = (resetsAt: number | null, now: number): string => {
  const short = formatResetShort(resetsAt, now)
  if (short === null) return 'Reset time unavailable'
  return short === 'now' ? 'Resetting now' : `Resets in ${short}`
}

/** Snapshot age as hh:mm:ss, the reference footer's ticking clock. */
export const formatAge = (readAt: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - readAt) / 1000))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3_600))}:${pad(Math.floor((seconds % 3_600) / 60))}:${pad(seconds % 60)}`
}

/** Banked reset expiries, soonest first, unknown last. */
export const bankedExpiries = (expiries: readonly (number | null)[]): (number | null)[] =>
  [...expiries].sort((left, right) => (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY))
