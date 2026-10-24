import { LatencyStats } from '../stats.js'
import type { SpanSample, SpanSampleQuery } from '../store.js'
import type { Breakdown, BreakdownInput, BreakdownRow } from './boards-api.js'

const MAX_BREAKDOWN_SAMPLES = 50_000
const NULL_GROUP = '\u0000null'

type SampleSource = { readonly spanSamples: (query: SpanSampleQuery) => { readonly samples: readonly SpanSample[]; readonly truncated: boolean } }

const groupKeyOf = (input: BreakdownInput, sample: SpanSample): string | null =>
  input.groupBy.kind === 'service' ? sample.service : input.groupBy.kind === 'operation' ? sample.name : sample.group

const rowOf = (key: string | null, samples: readonly SpanSample[], divisor: number | null): BreakdownRow => {
  const latency = LatencyStats.summarize(samples)
  const measures =
    divisor === null ? [] : samples.flatMap(sample => (sample.measure === null ? [] : [sample.measure / divisor])).sort((left, right) => left - right)
  return {
    key,
    count: latency.count,
    errorCount: latency.errorCount,
    errorRate: latency.errorRate,
    p50Ms: latency.p50Ms,
    p95Ms: latency.p95Ms,
    p99Ms: latency.p99Ms,
    maxMs: latency.maxMs,
    measureP50Ms: LatencyStats.percentile(measures, 0.5),
    measureP95Ms: LatencyStats.percentile(measures, 0.95),
  }
}

const sorters = {
  count: (left, right) => right.count - left.count,
  errorRate: (left, right) => right.errorRate - left.errorRate || right.errorCount - left.errorCount,
  p95: (left, right) => (right.p95Ms ?? 0) - (left.p95Ms ?? 0),
} satisfies Record<NonNullable<BreakdownInput['sortBy']>, (left: BreakdownRow, right: BreakdownRow) => number>

/** One board: the window's matching spans grouped by service, span name or an attribute, each group summarized like the Operations tab. */
const breakdown = (input: { readonly source: SampleSource; readonly query: BreakdownInput; readonly now: number }): Breakdown => {
  const query = input.query
  const { samples, truncated } = input.source.spanSamples({
    endedAfterMs: input.now - query.windowMinutes * 60_000,
    service: query.filter.service,
    operation: query.filter.operation,
    attribute: query.filter.attribute,
    groupAttribute: query.groupBy.kind === 'attribute' ? query.groupBy.key : undefined,
    measureAttribute: query.measure?.key,
    limit: MAX_BREAKDOWN_SAMPLES,
  })
  const groups = LatencyStats.groupBy(samples, sample => groupKeyOf(query, sample) ?? NULL_GROUP)
  return {
    windowMinutes: query.windowMinutes,
    spans: samples.length,
    truncated,
    rows: [...groups]
      .map(([key, group]) => rowOf(key === NULL_GROUP ? null : key, group, query.measure?.divisor ?? null))
      .sort(sorters[query.sortBy ?? 'count'])
      .slice(0, query.limit ?? 25),
  }
}

export class SpanBreakdown {
  static readonly compute = breakdown
}
