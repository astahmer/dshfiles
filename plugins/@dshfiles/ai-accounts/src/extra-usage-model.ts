import type { ExtraUsage } from './extra-usage-schema.js'

export interface ExtraUsageSummary {
  /** "Extra usage" when spend is on, "Extra usage off" otherwise. */
  readonly label: string
  /** "$12.34 of $50.00", "$12.34 spent · no cap reported", or null while off with nothing spent. */
  readonly amount: string | null
  /** Percent of the cap spent, clamped to 0–100; null without a cap. */
  readonly percentUsed: number | null
  /** Second line: percent, cap state and reset. */
  readonly detail: string
  readonly capReached: boolean
}

/** Pure presentation of a card's `extraUsage`, shared by the sidebar card, the account page and tests. */
export class ExtraUsageModel {
  private static amount = (extra: ExtraUsage, money: (amount: number) => string): string | null => {
    const cap = extra.monthlyLimit !== null && extra.monthlyLimit > 0 ? extra.monthlyLimit : null
    if (extra.used === null) return cap === null ? null : `${money(cap)} monthly cap`
    return cap === null ? `${money(extra.used)} spent · no cap reported` : `${money(extra.used)} of ${money(cap)}`
  }

  private static detail = (state: {
    readonly enabled: boolean
    readonly capReached: boolean
    readonly percent: number | null
    readonly reset: string
  }): string => {
    if (!state.enabled) return 'Requests stop at the plan limits. Turn extra usage on in Claude settings to keep working past them.'
    if (state.capReached) return `Monthly cap reached · ${state.reset}. Raise the cap in Claude settings → Usage to keep working.`
    if (state.percent === null) return `Billed past the plan limits · ${state.reset}`
    return `${String(Math.round(state.percent))}% of cap used · ${state.reset}`
  }

  static formatMoney = (amount: number, currency: string, locale?: string): string => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
    } catch {
      return `${amount.toFixed(2)} ${currency}`
    }
  }

  static summarize = (extra: ExtraUsage, formatReset: (resetsAt: number) => string, locale?: string): ExtraUsageSummary => {
    const money = (amount: number): string => ExtraUsageModel.formatMoney(amount, extra.currency, locale)
    const percent = extra.percentUsed === null ? null : Math.max(0, Math.min(100, extra.percentUsed))
    const hasCap = extra.monthlyLimit !== null && extra.monthlyLimit > 0
    const capReached = extra.enabled && hasCap && percent !== null && percent >= 100
    const amount = ExtraUsageModel.amount(extra, money)
    const reset = extra.resetsAt === null ? 'monthly, no reset date reported' : formatReset(extra.resetsAt)
    const detail = ExtraUsageModel.detail({ enabled: extra.enabled, capReached, percent, reset })
    return { label: extra.enabled ? 'Extra usage' : 'Extra usage off', amount, percentUsed: hasCap ? percent : null, detail, capReached }
  }
}
