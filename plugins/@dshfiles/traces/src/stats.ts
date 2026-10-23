import type { Latency } from './types.js'

/** Nearest-rank percentile over an ascending list: the smallest value with at least `fraction` of samples at or below it. */
const percentile = (sortedAscending: readonly number[], fraction: number): number | null => {
  if (sortedAscending.length === 0) return null
  const rank = Math.max(1, Math.ceil(fraction * sortedAscending.length))
  return sortedAscending[Math.min(sortedAscending.length, rank) - 1] ?? null
}

export type DurationSample = { readonly durationMs: number; readonly error: boolean }

const summarizeLatency = (samples: readonly DurationSample[]): Latency => {
  const durations = samples.map(sample => sample.durationMs).sort((left, right) => left - right)
  const errorCount = samples.filter(sample => sample.error).length
  return {
    count: samples.length,
    errorCount,
    errorRate: samples.length === 0 ? 0 : errorCount / samples.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations.at(-1) ?? null,
  }
}

const groupBy = <Item>(items: readonly Item[], keyOf: (item: Item) => string): Map<string, Item[]> => {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [item])
    else group.push(item)
  }
  return groups
}

export class LatencyStats {
  static readonly percentile = percentile
  static readonly summarize = summarizeLatency
  static readonly groupBy = groupBy
}
