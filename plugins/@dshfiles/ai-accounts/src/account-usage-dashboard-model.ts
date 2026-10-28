import type { ChartQuery, ChartView, RequestPage } from '@dshfiles/usage/api'

export type UsagePeriod = (typeof AccountUsageDashboardModel.USAGE_PERIODS)[number]

export interface AccountUsageDay {
  start: number
  label: string
  requests: number
  input: number | null
  output: number | null
  tokens: number | null
  cost: number | null
}

export class AccountUsageDashboardModel {
  static readonly USAGE_PERIODS = [7, 30, 90] as const
  static readonly DAY_MS = 86_400_000

  static accountUsageQuery(provider: string, days: UsagePeriod, now: number): ChartQuery {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    return {
      provider,
      from: today.getTime() - (days - 1) * AccountUsageDashboardModel.DAY_MS,
      to: today.getTime() + AccountUsageDashboardModel.DAY_MS,
      bucket: 'day',
      groupBy: 'model',
      tzOffsetMinutes: -today.getTimezoneOffset(),
    }
  }

  /** Never display an unfiltered old-Host response as account data. */
  static requireAccountUsageScope(provider: string, charts: ChartView, requests: RequestPage): void {
    if (charts.appliedProvider !== provider || requests.appliedProvider !== provider || requests.rows.some(row => row.provider !== provider))
      throw new Error('Account-scoped usage requires an updated Usage Host. No unfiltered account data is shown.')
  }

  static totalTokens(summary: Pick<ChartView['summary'], 'requests' | 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'missingUsage'>): number | null {
    return summary.requests === 0 ? 0 : summary.missingUsage === 0 ? summary.input + summary.cacheRead + summary.cacheWrite + summary.output : null
  }

  static completeCost(summary: { requests: number; cost: number; missingUsage?: number | undefined; unpriced?: number | undefined }): number | null {
    return summary.requests === 0 ? 0 : summary.missingUsage === 0 && summary.unpriced === 0 ? summary.cost : null
  }

  static percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
    return current == null || previous == null || previous <= 0 ? null : ((current - previous) / previous) * 100
  }

  static usageCount(value: number | null | undefined): string {
    return value == null
      ? '—'
      : new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
  }

  static usageCost(value: number | null | undefined): string {
    return value == null
      ? '—'
      : new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
        }).format(value)
  }

  static usageDuration(value: number | null | undefined): string {
    return value == null ? '—' : value < 1_000 ? `${String(Math.round(value))}ms` : `${(value / 1_000).toFixed(1)}s`
  }

  static usageDate(value: number): string {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  /** Bucket sums, not a sample of recent requests. Nulls remain gaps rather than fabricated zeros. */
  static accountUsageDays(query: ChartQuery, view: ChartView): AccountUsageDay[] {
    const offset = query.tzOffsetMinutes * 60_000
    const rows = new Map<number, { requests: number; input: number; output: number; tokens: number; cost: number; tokensKnown: boolean; costKnown: boolean }>()
    for (const bucket of view.buckets) {
      const current = rows.get(bucket.start) ?? { requests: 0, input: 0, output: 0, tokens: 0, cost: 0, tokensKnown: true, costKnown: true }
      current.requests += bucket.requests
      current.input += bucket.input + bucket.cacheRead + bucket.cacheWrite
      current.output += bucket.output
      current.tokens += bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output
      current.cost += bucket.cost
      current.tokensKnown &&= bucket.missingUsage === 0
      current.costKnown &&= bucket.missingUsage === 0 && bucket.unpriced === 0
      rows.set(bucket.start, current)
    }
    const result: AccountUsageDay[] = []
    for (
      let start = Math.floor((query.from + offset) / AccountUsageDashboardModel.DAY_MS) * AccountUsageDashboardModel.DAY_MS - offset;
      start < query.to;
      start += AccountUsageDashboardModel.DAY_MS
    ) {
      const row = rows.get(start)
      result.push({
        start,
        label: AccountUsageDashboardModel.usageDate(start),
        requests: row?.requests ?? 0,
        input: row === undefined ? 0 : row.tokensKnown ? row.input : null,
        output: row === undefined ? 0 : row.tokensKnown ? row.output : null,
        tokens: row === undefined ? 0 : row.tokensKnown ? row.tokens : null,
        cost: row === undefined ? 0 : row.costKnown ? row.cost : null,
      })
    }
    return result
  }
}
