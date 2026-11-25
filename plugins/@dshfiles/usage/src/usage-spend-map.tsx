import { ModelMark, modelFamily } from '@dshfiles/plugin-ui/components/model-mark'
import { SpendMap, type SpendDimension, type SpendLeaf } from '@dshfiles/plugin-ui/components/motion/spend-map'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { BoxIcon, FolderIcon, KeyRoundIcon, TargetIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'
import type { ChartQuery, ChartView } from './api.js'
import { DATA_SERIES } from './data-series.js'
import { UsageFormattingModel } from './format.js'

type SpendMetric = 'cost' | 'tokens' | 'requests'
type BreakdownRow = ChartView['breakdown']['model'][number]

const LEAF_LIMIT = 6
/** End nodes stop at 280 px: one model no longer runs a 1000 px node across the card (council round 5, D1). */
const LEAF_MAX_WIDTH = 280
const REST_ID = 'other:rest'

/**
 * Each breakdown's card tone on the data ramp, in order, so Accounts and Projects read as their own series instead of
 * grey (council round 7, D3). The grouped breakdown takes its top entry's chart colour instead.
 */
const DIMENSIONS = [
  { id: 'model', label: 'Models', icon: <BoxIcon aria-hidden />, tone: DATA_SERIES[0] },
  { id: 'provider', label: 'Accounts', icon: <KeyRoundIcon aria-hidden />, tone: DATA_SERIES[1] },
  { id: 'project', label: 'Projects', icon: <FolderIcon aria-hidden />, tone: DATA_SERIES[2] },
  { id: 'purpose', label: 'Purposes', icon: <TargetIcon aria-hidden />, tone: DATA_SERIES[3] },
] as const satisfies readonly { readonly id: ChartQuery['groupBy']; readonly label: string; readonly icon: ReactNode; readonly tone: string }[]

const purposeLabels = new Map<string, string>(Object.entries(UsageFormattingModel.purposeLabels))

const isGroupBy = (value: string): value is ChartQuery['groupBy'] => DIMENSIONS.some(dimension => dimension.id === value)

const amountOf = (row: { readonly cost: number; readonly tokens: number; readonly requests: number }, metric: SpendMetric): number =>
  metric === 'cost' ? row.cost : metric === 'tokens' ? row.tokens : row.requests

const formatterFor = (metric: SpendMetric): ((value: number) => string) =>
  metric === 'cost' ? UsageFormattingModel.formatCost : metric === 'tokens' ? UsageFormattingModel.formatCount : value => Math.round(value).toLocaleString()

/**
 * One SpendMap dimension per breakdown the Host returns: its largest entries by the chosen measure, the rest folded
 * into one entry. Only the grouped dimension has per-bucket series, so only its entries get a sparkline and the colour
 * the chart above gives the same key (its index in `view.keys` on the data ramp), so one model keeps one colour.
 */
export const spendDimensions = (input: {
  readonly view: ChartView
  readonly metric: SpendMetric
  readonly groupBy: ChartQuery['groupBy']
}): SpendDimension[] => {
  const starts = [...new Set(input.view.buckets.map(bucket => bucket.start))].sort((left, right) => left - right)
  const seriesOf = (key: string): readonly number[] => {
    const byStart = new Map<number, number>()
    for (const bucket of input.view.buckets) {
      if (bucket.key === key)
        byStart.set(
          bucket.start,
          (byStart.get(bucket.start) ?? 0) + amountOf({ ...bucket, tokens: bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output }, input.metric),
        )
    }
    return starts.map(start => byStart.get(start) ?? 0)
  }
  const colorOf = (key: string): string | undefined => {
    const index = input.view.keys.indexOf(key)
    return index < 0 ? undefined : DATA_SERIES[index % DATA_SERIES.length]
  }
  return DIMENSIONS.flatMap(dimension => {
    const rows: readonly BreakdownRow[] | undefined = input.view.breakdown[dimension.id]
    if (rows === undefined) return []
    const sorted = [...rows].sort((left, right) => amountOf(right, input.metric) - amountOf(left, input.metric))
    const total = sorted.reduce((sum, row) => sum + amountOf(row, input.metric), 0)
    const shareOf = (amount: number): number => (total > 0 ? amount / total : 0)
    const shown = sorted.slice(0, LEAF_LIMIT)
    const rest = sorted.slice(LEAF_LIMIT)
    const leaves: SpendLeaf[] = shown.map(row => {
      const amount = amountOf(row, input.metric)
      const color = dimension.id === input.groupBy ? colorOf(row.key) : undefined
      // A model or an account named after a provider shows that provider's mark in its seat instead of a letter.
      const branded = (dimension.id === 'model' || dimension.id === 'provider') && modelFamily(row.key) !== undefined
      return {
        id: row.key,
        ...(branded && { icon: <ModelMark modelId={row.key} /> }),
        label: dimension.id === 'purpose' ? (purposeLabels.get(row.key) ?? row.key) : row.key,
        amount,
        share: shareOf(amount),
        ...(input.metric === 'cost' && (row.unpriced ?? 0) > 0 && { flag: { label: 'Unpriced', tone: 'warning' as const } }),
        ...(dimension.id === input.groupBy && { series: seriesOf(row.key) }),
        ...(color !== undefined && { color }),
      }
    })
    if (rest.length > 0) {
      const amount = rest.reduce((sum, row) => sum + amountOf(row, input.metric), 0)
      leaves.push({ id: REST_ID, label: `${String(rest.length)} more`, amount, share: shareOf(amount) })
    }
    const cardColor = (dimension.id === input.groupBy ? leaves[0]?.color : undefined) ?? dimension.tone
    return [{ id: dimension.id, label: dimension.label, icon: dimension.icon, leaves, color: cardColor }]
  })
}

const formatDay = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * The kit SpendMap's radial tick gauge reads as decoration on a range with no cap: hide its drawing and keep the total as
 * a plain value where the connectors start (council round 2, D1). Follow-up: a kit prop for a gauge-less root.
 */
const PLAIN_TOTAL =
  'dshx:[&_[data-node-anchor=root]_svg]:hidden dshx:[&_[data-node-anchor=root]>div]:size-auto dshx:[&_[data-node-anchor=root]>div>div]:static dshx:[&_[data-node-anchor=root]>div>div]:px-1'

/**
 * The card the numbers and the trend chart take (8 px radius, not the kit map's 16), and a 12 px lead-in from the heading
 * to the first node: the header's 12 px and none of the map's top padding, so the map's first result shows above the
 * fold at 1440 × 900 (council round 6, D1). Follow-up: a kit prop for the map's top padding.
 */
export const SPEND_MAP_CARD = 'dshx:rounded-lg dshx:[&_[data-spend-map-inset]>div]:pt-0'

export const UsageSpendMap = (props: {
  readonly view: ChartView
  /** The chart's measure: the page has one metric switch, on the chart card. */
  readonly metric: SpendMetric
  readonly range: { readonly from: number; readonly to: number }
  readonly groupBy: ChartQuery['groupBy']
  readonly onGroupBy: (groupBy: ChartQuery['groupBy']) => void
  readonly onShowRequests: (search: string, groupBy: ChartQuery['groupBy']) => void
}): JSX.Element => {
  const metric = props.metric
  const [leafId, setLeafId] = useState<string | null>(null)
  const dimensions = spendDimensions({ view: props.view, metric, groupBy: props.groupBy })
  const dimension = dimensions.find(entry => entry.id === props.groupBy) ?? dimensions[0]
  const leaf = dimension?.leaves.find(entry => entry.id === leafId) ?? dimension?.leaves[0]
  const summary = props.view.summary
  const total = amountOf(
    { cost: summary.cost, requests: summary.requests, tokens: summary.input + summary.cacheRead + summary.cacheWrite + summary.output },
    metric,
  )
  const period = `${formatDay(props.range.from)} – ${formatDay(props.range.to - 1)}`
  return (
    <SpendMap
      data-usage-spend-map
      className={cn(PLAIN_TOTAL, SPEND_MAP_CARD)}
      inset="flush"
      leafMaxWidth={LEAF_MAX_WIDTH}
      detailPeriod="this range"
      dimensionId={dimension?.id ?? props.groupBy}
      dimensions={dimensions}
      footer={
        leaf === undefined || leaf.id === REST_ID || dimension === undefined || !isGroupBy(dimension.id) ? undefined : (
          <Button className="dshx:ml-auto" size="xs" variant="outline" onClick={() => props.onShowRequests(leaf.id, props.groupBy)}>
            Show requests
          </Button>
        )
      }
      format={formatterFor(metric)}
      heading="Where it went"
      leafId={leaf?.id ?? null}
      onDimensionChange={id => {
        if (isGroupBy(id)) props.onGroupBy(id)
        setLeafId(null)
      }}
      onLeafChange={setLeafId}
      owner={props.view.appliedProvider ?? 'All accounts'}
      period={period}
      total={total}
    />
  )
}
