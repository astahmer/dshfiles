import type { UsageHistoryPoint } from './usage-history-model.js'

const MINUTE_MS = 60_000
const MIN_FORECAST_SPAN_MS = 30 * MINUTE_MS
const FORECAST_SAMPLE_LIMIT = 48

export type QuotaForecast =
  | { status: 'insufficient-history'; sampleCount: number }
  | { status: 'reset-due'; sampleCount: number }
  | { status: 'no-depletion'; sampleCount: number; percentPerHour: number }
  | { status: 'estimated-depletion'; sampleCount: number; percentPerHour: number; estimatedAt: number }
  | {
      status: 'depletes-before-reset' | 'reset-before-depletion'
      sampleCount: number
      percentPerHour: number
      estimatedAt: number
      resetsAt: number
    }

export interface QuotaHistoryRow {
  readonly at: number
  readonly percent: number
  /** The provider window this reading belongs to; one colour per window. */
  readonly window: string
  /** Window plus reset cycle, so a line breaks where the provider reset it. */
  readonly cycle: string
}

export class QuotaHistoryAnalysis {
  static forecastQuotaWindow = (input: {
    points: readonly UsageHistoryPoint[]
    label: string
    remainingPercent: number
    resetsAt: number | null
    now: number
  }): QuotaForecast => {
    if (input.resetsAt !== null && input.resetsAt <= input.now) {
      return { status: 'reset-due', sampleCount: 0 }
    }

    const ordered = [...input.points].filter(point => point.at <= input.now).sort((left, right) => left.at - right.at)
    const lastReset = [...ordered].reverse().find(point => point.resetsAt[input.label] !== undefined)?.resetsAt[input.label]
    const cycleReset = input.resetsAt ?? lastReset
    const cycle = ordered
      .filter(
        point =>
          point.windows[input.label] !== undefined &&
          (cycleReset === undefined ? point.resetsAt[input.label] === undefined : point.resetsAt[input.label] === cycleReset),
      )
      .slice(-FORECAST_SAMPLE_LIMIT)
    const first = cycle[0]
    const last = cycle.at(-1)
    if (cycle.length < 3 || first === undefined || last === undefined || last.at - first.at < MIN_FORECAST_SPAN_MS) {
      return { status: 'insufficient-history', sampleCount: cycle.length }
    }

    const origin = first.at
    const xs = cycle.map(point => (point.at - origin) / MINUTE_MS)
    const ys = cycle.map(point => point.windows[input.label] ?? 0)
    const meanX = xs.reduce((total, value) => total + value, 0) / xs.length
    const meanY = ys.reduce((total, value) => total + value, 0) / ys.length
    const covariance = xs.reduce((total, value, index) => total + (value - meanX) * ((ys[index] ?? 0) - meanY), 0)
    const variance = xs.reduce((total, value) => total + (value - meanX) ** 2, 0)
    if (variance === 0) return { status: 'insufficient-history', sampleCount: cycle.length }

    const percentPerMinute = covariance / variance
    const percentPerHour = percentPerMinute * 60
    if (!Number.isFinite(percentPerHour) || percentPerMinute >= 0) {
      return { status: 'no-depletion', sampleCount: cycle.length, percentPerHour: Number.isFinite(percentPerHour) ? percentPerHour : 0 }
    }

    const estimatedAt = input.now + (Math.max(0, input.remainingPercent) / -percentPerMinute) * MINUTE_MS
    if (!Number.isFinite(estimatedAt)) return { status: 'insufficient-history', sampleCount: cycle.length }
    if (input.resetsAt === null) {
      return { status: 'estimated-depletion', sampleCount: cycle.length, percentPerHour, estimatedAt }
    }
    return {
      status: estimatedAt <= input.resetsAt ? 'depletes-before-reset' : 'reset-before-depletion',
      sampleCount: cycle.length,
      percentPerHour,
      estimatedAt,
      resetsAt: input.resetsAt,
    }
  }

  /** Keep only the first banked-reset observation and subsequent changes. */
  static changedBankedResetSnapshots = (points: readonly UsageHistoryPoint[]): readonly UsageHistoryPoint[] => {
    const ordered = [...points].sort((left, right) => left.at - right.at)
    const changed: UsageHistoryPoint[] = []
    let previousSignature: string | undefined
    for (const point of ordered) {
      const signature = JSON.stringify({
        balance: point.bankedResets,
        expiries: (point.bankedResetExpiries ?? []).map(value => value ?? null),
      })
      if (signature === previousSignature) continue
      changed.push(point)
      previousSignature = signature
    }
    return changed
  }

  static quotaHistoryCycles = (points: readonly UsageHistoryPoint[], label: string): readonly (readonly UsageHistoryPoint[])[] => {
    const ordered = [...points].sort((left, right) => left.at - right.at)
    const cycles = new Map<string, UsageHistoryPoint[]>()
    for (const point of ordered) {
      if (point.windows[label] === undefined) continue
      const reset = point.resetsAt[label]
      const key = reset === undefined ? 'unknown-reset' : String(reset)
      const series = cycles.get(key) ?? []
      series.push(point)
      cycles.set(key, series)
    }
    return [...cycles.values()]
  }

  private static downsample = <T>(values: readonly T[], limit: number): readonly T[] => {
    if (values.length <= limit) return values
    if (limit < 2) return values.slice(-limit)
    const last = values.length - 1
    return Array.from({ length: limit }, (_, index) => values[Math.round((index * last) / (limit - 1))]).filter((value): value is T => value !== undefined)
  }

  /**
   * One line per labelled window per reset cycle, percent clamped to 0–100, with
   * each window's cycles sharing a point budget so a long range stays drawable.
   */
  static quotaHistoryRows = (points: readonly UsageHistoryPoint[], pointLimit: number): readonly QuotaHistoryRow[] => {
    const windows = [...new Set(points.flatMap(point => Object.keys(point.windows)))]
    return windows.flatMap(window => {
      const cycles = QuotaHistoryAnalysis.quotaHistoryCycles(points, window)
      const perCycleLimit = Math.max(2, Math.floor(pointLimit / Math.max(1, cycles.length)))
      return cycles.flatMap((cycle, cycleIndex) =>
        QuotaHistoryAnalysis.downsample(cycle, perCycleLimit).map(point => ({
          at: point.at,
          percent: Math.max(0, Math.min(100, point.windows[window] ?? 0)),
          window,
          cycle: `${window}:${String(cycleIndex)}`,
        })),
      )
    })
  }
}
