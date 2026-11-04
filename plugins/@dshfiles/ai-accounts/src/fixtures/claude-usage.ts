/**
 * Claude `GET /api/oauth/usage` bodies, shaped like Anthropic's responses (field names from CodexBar's decoder and
 * live readings). `extra_usage` amounts are in cents. Synthetic values only; no account data.
 */
export const claudeUsageWithExtraUsage = {
  five_hour: { utilization: 100, resets_at: '2026-11-04T15:00:00Z' },
  seven_day: { utilization: 64, resets_at: '2026-11-08T09:00:00Z' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: true, monthly_limit: 5_000, used_credits: 1_234, utilization: 24.68, currency: 'USD' },
} as const

export const claudeUsageExtraUsageOff = {
  five_hour: { utilization: 12, resets_at: '2026-11-04T15:00:00Z' },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
} as const

/** Enterprise spend-only: no plan windows, only the spend limit. */
export const claudeUsageSpendOnly = {
  five_hour: null,
  seven_day: null,
  extra_usage: { is_enabled: true, monthly_limit: 20_000, used_credits: 20_000, currency: 'eur' },
} as const

export const claudeUsageMalformedExtraUsage = {
  five_hour: { utilization: 40, resets_at: null },
  extra_usage: { is_enabled: 'yes', used_credits: 'many' },
} as const
