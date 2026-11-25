/**
 * Bar geometry shared by the Usage bar charts. A band scale gives one bucket the whole plot, so a range with one
 * occupied day drew a full-width slab: bars stop at 44 px, fill about 85 % of their band and round their top end only.
 */
export const BAND_PADDING = 0.15

export const BAR_GEOMETRY = { maxThickness: 44, radius: { end: 3, stack: 'outer' } } as const

/** Gridlines in the hairline border at half strength, so they sit behind the bars. */
export const CHART_GRID = { stroke: 'var(--dsw-alias-border-l2)', strokeOpacity: 0.5 }

/**
 * The one bucket that holds a value, with its total; `null` when none or several do. A lone bar has no neighbour to
 * compare with, so the chart prints its value above it instead of making the reader trace it to the axis.
 */
export const singleBucketTotal = <Row extends { readonly label: string }>(
  rows: readonly Row[],
  value: (row: Row) => number,
): { readonly label: string; readonly total: number } | null => {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const amount = value(row)
    if (amount > 0) totals.set(row.label, (totals.get(row.label) ?? 0) + amount)
  }
  const [only, ...rest] = [...totals]
  return only === undefined || rest.length > 0 ? null : { label: only[0], total: only[1] }
}

export type TrendMetric = 'cost' | 'tokens' | 'requests'

interface TrendBucket {
  readonly start: number
  readonly key: string
  readonly cost: number
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly requests: number
}

export interface TrendRow {
  readonly label: string
  readonly key: string
  readonly value: number
}

/**
 * The "… over time" chart's rows for one measure, one per bucket and series key, in time order. Band scales take their
 * domain from the rows, so every bucket of the range with no row gets a zero row: a 7-day view keeps seven slots and
 * seven ticks in every measure.
 */
export const trendRows = (input: {
  readonly labels: readonly string[]
  readonly buckets: readonly TrendBucket[]
  readonly labelOf: (start: number) => string
  readonly keyOf: (key: string) => string
  readonly firstKey: string
  readonly metric: TrendMetric
}): TrendRow[] => {
  const valueOf = (row: TrendBucket): number =>
    input.metric === 'cost' ? row.cost : input.metric === 'tokens' ? row.input + row.cacheRead + row.cacheWrite + row.output : row.requests
  const rows = input.buckets
    .filter(row => input.metric !== 'cost' || row.cost > 0)
    .map(row => ({ label: input.labelOf(row.start), key: input.keyOf(row.key), value: valueOf(row) }))
  const present = new Set(rows.map(row => row.label))
  rows.push(...input.labels.filter(label => !present.has(label)).map(label => ({ label, key: input.firstKey, value: 0 })))
  const order = new Map(input.labels.map((label, index) => [label, index]))
  return rows.sort((left, right) => (order.get(left.label) ?? 0) - (order.get(right.label) ?? 0))
}
