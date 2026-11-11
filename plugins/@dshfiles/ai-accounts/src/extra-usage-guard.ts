import type { AccountPoolView } from './account-pool.js'
import type { AccountsUsage, UsageCard } from './api.js'

/**
 * Refusing a provider's paid overage once the plan is spent.
 *
 * A provider that reports `extraUsage` will bill past the plan's windows when
 * its own extra-usage setting is on. An account leaves that to the provider
 * unless the user turned "Use extra usage" on for it: with the setting off and a
 * plan window spent, the account counts as exhausted, so routing skips it, a
 * turn stops before it can draw overage, and the reset lifts the block.
 *
 * The decision comes from the last quota reading, never from the request itself,
 * so a request can still start a few minutes into overage between readings.
 */

/** Windows every provider meters against the plan; Claude's Opus/Sonnet windows only narrow one model. */
const GENERIC_PLAN_WINDOWS: ReadonlySet<string> = new Set(['Current session', 'Weekly limit', 'Monthly limit'])

/** A spent window that reports no reset re-blocks on the next reading; this bounds the gap between readings. */
export const UNKNOWN_RESET_HOLD_MS = 15 * 60_000

export interface PlanBlock {
  readonly blocked: boolean
  /** The spent plan window that blocks, when one does. */
  readonly window: string | null
  /** The reset that lifts the block, when every spent window reports one. */
  readonly resetsAt: number | null
}

const notBlocked: PlanBlock = { blocked: false, window: null, resetsAt: null }

interface SpentWindow {
  readonly label: string
  readonly resetsAt: number | null
}

const spentPlanWindows = (usage: UsageCard, now: number): readonly SpentWindow[] =>
  usage.windows.flatMap(window =>
    window.reserve !== true &&
    GENERIC_PLAN_WINDOWS.has(window.label) &&
    Math.round(window.percentRemaining) <= 0 &&
    (window.resetsAt === null || window.resetsAt > now)
      ? [{ label: window.label, resetsAt: window.resetsAt }]
      : [],
  )

export class ExtraUsageGuardModel {
  /** Whether this reading leaves the account without plan quota and without permission to draw overage. */
  static block = (input: { readonly usage: UsageCard | undefined; readonly useExtraUsage: boolean; readonly now: number }): PlanBlock => {
    const usage = input.usage
    if (usage === undefined || usage.status !== 'ok' || input.useExtraUsage) return notBlocked
    // A provider that reports extra usage off already refuses overage itself, and says so in its own error.
    if (usage.extraUsage === undefined || !usage.extraUsage.enabled) return notBlocked
    const spent = spentPlanWindows(usage, input.now)
    if (spent.length === 0) return notBlocked
    const window = spent.map(candidate => candidate.label).join(' and ')
    if (spent.some(candidate => candidate.resetsAt === null)) return { blocked: true, window, resetsAt: null }
    const resetsAt = Math.max(...spent.map(candidate => candidate.resetsAt ?? 0))
    return { blocked: true, window, resetsAt }
  }

  /** When the pool may try the account again: its reset, or a bounded hold when no window reports one. */
  static until = (input: { readonly block: PlanBlock; readonly now: number }): number | null =>
    input.block.blocked ? (input.block.resetsAt ?? input.now + UNKNOWN_RESET_HOLD_MS) : null

  /**
   * Publish every reading's decision to the pool, so routing already skips a spent account. A card the reading does
   * not carry keeps its last block: no reading is not evidence that the plan recovered.
   */
  static apply = (input: {
    readonly pool: Pick<AccountPoolView, 'planBlock' | 'clearPlanBlock'>
    readonly accounts: readonly { readonly instanceId: string; readonly useExtraUsage?: boolean | undefined }[]
    readonly usage: AccountsUsage | undefined
    readonly now: number
  }): void => {
    const useExtraUsage = new Map(input.accounts.map(account => [account.instanceId, account.useExtraUsage === true]))
    for (const card of input.usage?.cards ?? []) {
      const block = ExtraUsageGuardModel.block({ usage: card.usage, useExtraUsage: useExtraUsage.get(card.instanceId) === true, now: input.now })
      const until = ExtraUsageGuardModel.until({ block, now: input.now })
      if (until === null) input.pool.clearPlanBlock(card.instanceId)
      else input.pool.planBlock(card.instanceId, until)
    }
  }

  /** The turn-stopping message: what is spent, why no overage is drawn, and the three ways forward. */
  static recoveryMessage = (input: { readonly displayName: string; readonly block: PlanBlock; readonly formatReset: (resetsAt: number) => string }): string => {
    const windows = input.block.window ?? 'plan limit'
    const spent = windows.includes(' and ') ? `The ${windows} windows are` : `The ${windows} is`
    const reset = input.block.resetsAt === null ? 'the next provider reset' : input.formatReset(input.block.resetsAt)
    return `${spent} spent for ${input.displayName} and extra usage is off for that account, so this turn would draw paid overage. Turn on "Use extra usage" for it in Settings → AI Accounts, switch this thread to another account, or wait until ${reset}.`
  }
}
