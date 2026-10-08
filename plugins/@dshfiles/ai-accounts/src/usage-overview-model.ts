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

export const overviewCards = (usage: AccountsUsage | null, tab: ProviderTab): OverviewCard[] =>
  (usage?.cards ?? [])
    .filter(card => card.enabled && (tab === 'all' || card.kind === tab))
    .map(card => ({ ...card, usage: { ...card.usage, windows: sortWindows(card.usage.windows) } }))

/** The lowest percent left across enabled accounts, for the footer button. */
export const tightestRemaining = (usage: AccountsUsage | null): number | undefined => {
  let lowest: number | undefined
  for (const card of usage?.cards ?? []) {
    if (!card.enabled || card.usage.status !== 'ok') continue
    for (const window of card.usage.windows) lowest = Math.min(lowest ?? window.percentRemaining, window.percentRemaining)
  }
  return lowest
}

/** "Resets in 1h 11m", "Resets in 5d 20h", or a plain fallback. */
export const formatResetIn = (resetsAt: number | null, now: number): string => {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return 'Reset time unavailable'
  const remaining = resetsAt - now
  if (remaining <= 0) return 'Resetting now'
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1_440)
  if (days > 0) return `Resets in ${String(days)}d ${String(Math.floor((minutes % 1_440) / 60))}h`
  if (minutes >= 60) return `Resets in ${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
  return `Resets in ${String(Math.max(1, minutes))}m`
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
