import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import { formatDurationMs } from '@dshfiles/plugin-ui/lib/format-duration'
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

  /** A subagent in the family list by its title; never its raw Session id (DESIGN.md: no raw ids in labels). */
  static readonly familyMemberTitle = (member: { readonly title: string | null }): string => {
    const title = member.title?.trim() ?? ''
    return title === '' ? 'Untitled subagent' : title
  }

  private static readonly relativeSuffix = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

  /** `89K`, `1.3K`, `2.1M`; `–` when the count is unknown. */
  static readonly formatCount = (value: number | null): string => {
    if (value === null) return '–'
    if (value < 1_000) return String(Math.round(value))
    const [divisor, suffix] = value < 1_000_000 ? [1_000, 'K'] : value < 1_000_000_000 ? [1_000_000, 'M'] : [1_000_000_000, 'B']
    const scaled = value / divisor
    return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled))}${suffix}`
  }

  /** The AI Accounts dollar rule; `–` when unpriced. */
  static readonly formatCost = (value: number | null): string => (value === null ? '–' : CostEstimateModel.formatUsd(value))

  /** `–` when unknown. */
  static readonly formatDuration = (ms: number | null): string => (ms === null ? '–' : formatDurationMs(ms))

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
