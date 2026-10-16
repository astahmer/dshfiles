import type { RequestPurpose } from './fold.js'

export type OpenThread = (target: { readonly sessionId: string; readonly parentSessionId: string | null }) => 'opened' | 'parent' | 'missing'

export class UsageFormattingModel {
  static readonly purposeLabels = {
    agent: 'Agent',
    subagent: 'Subagent',
    compaction: 'Compaction',
    title: 'Title',
    memory: 'Memory summary',
    other: 'Other side call',
  } satisfies Readonly<Record<RequestPurpose, string>>

  private static readonly relativeSuffix = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

  /** `89K`, `1.3K`, `2.1M`; `–` when the count is unknown. */
  static readonly formatCount = (value: number | null): string => {
    if (value === null) return '–'
    if (value < 1_000) return String(Math.round(value))
    const [divisor, suffix] = value < 1_000_000 ? [1_000, 'K'] : value < 1_000_000_000 ? [1_000_000, 'M'] : [1_000_000_000, 'B']
    const scaled = value / divisor
    return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled))}${suffix}`
  }

  /** `$0.0456` below a dollar, `$12.34` below a hundred, `$1,234` above; `–` when unpriced. */
  static readonly formatCost = (value: number | null): string => {
    if (value === null) return '–'
    if (value === 0) return '$0'
    if (value < 0.0001) return '<$0.0001'
    if (value < 1) return `$${value.toFixed(4)}`
    if (value < 100) return `$${value.toFixed(2)}`
    return `$${Math.round(value).toLocaleString('en-US')}`
  }

  /** `820ms`, `3.5s`, `1m 24s`; `–` when unknown. */
  static readonly formatDuration = (ms: number | null): string => {
    if (ms === null) return '–'
    if (ms < 1_000) return `${String(Math.round(ms))}ms`
    if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60_000)
    return `${String(minutes)}m ${String(Math.round((ms - minutes * 60_000) / 1_000))}s`
  }

  static readonly formatAgo = (
    at: number,
    now: number,
    relativeTime: (at: number, now: number) => { readonly n: number; readonly unit: keyof typeof UsageFormattingModel.relativeSuffix },
  ): string => {
    const age = relativeTime(at, now)
    return age.unit === 'now' ? 'now' : `${String(age.n)}${UsageFormattingModel.relativeSuffix[age.unit]} ago`
  }

  static readonly formatPercent = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? '–' : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`

  /** Share of the prompt served from cache: cache reads over every prompt token. */
  static readonly cacheHitRatio = (tokens: { readonly input: number; readonly cacheRead: number; readonly cacheWrite: number }): number | null => {
    const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
    return prompt === 0 ? null : tokens.cacheRead / prompt
  }

  /** Signed change against the previous period, or null when there was nothing to compare with. */
  static readonly changeRatio = (current: number, previous: number): number | null => (previous === 0 ? null : (current - previous) / previous)
}
