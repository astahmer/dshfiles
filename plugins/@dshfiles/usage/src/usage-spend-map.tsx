import { SpendMap, type SpendDimension, type SpendLeaf } from '@dshfiles/plugin-ui/components/motion/spend-map'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { BoxIcon, FolderIcon, KeyRoundIcon, TargetIcon } from '@dshfiles/plugin-ui/icons'
import { useState, type ReactNode } from 'react'
import type { ChartQuery, ChartView } from './api.js'
import { UsageFormattingModel } from './format.js'

type SpendMetric = 'cost' | 'tokens' | 'requests'
type BreakdownRow = ChartView['breakdown']['model'][number]

const LEAF_LIMIT = 6
const REST_ID = 'other:rest'

const DIMENSIONS = [
  { id: 'model', label: 'Models', icon: <BoxIcon aria-hidden /> },
  { id: 'provider', label: 'Accounts', icon: <KeyRoundIcon aria-hidden /> },
  { id: 'project', label: 'Projects', icon: <FolderIcon aria-hidden /> },
  { id: 'purpose', label: 'Purposes', icon: <TargetIcon aria-hidden /> },
] as const satisfies readonly { readonly id: ChartQuery['groupBy']; readonly label: string; readonly icon: ReactNode }[]

const METRICS = [
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'requests', label: 'Requests' },
] as const satisfies readonly { readonly value: SpendMetric; readonly label: string }[]

const purposeLabels = new Map<string, string>(Object.entries(UsageFormattingModel.purposeLabels))

const isGroupBy = (value: string): value is ChartQuery['groupBy'] => DIMENSIONS.some(dimension => dimension.id === value)
const isMetric = (value: string): value is SpendMetric => METRICS.some(metric => metric.value === value)

const amountOf = (row: { readonly cost: number; readonly tokens: number; readonly requests: number }, metric: SpendMetric): number =>
  metric === 'cost' ? row.cost : metric === 'tokens' ? row.tokens : row.requests

const formatterFor = (metric: SpendMetric): ((value: number) => string) =>
  metric === 'cost' ? UsageFormattingModel.formatCost : metric === 'tokens' ? UsageFormattingModel.formatCount : value => Math.round(value).toLocaleString()

/**
 * One SpendMap dimension per breakdown the Host returns: its largest entries by the chosen measure, the rest folded
 * into one entry. Only the grouped dimension has per-bucket series, so only its entries get a sparkline.
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
      return {
        id: row.key,
        label: dimension.id === 'purpose' ? (purposeLabels.get(row.key) ?? row.key) : row.key,
        amount,
        share: shareOf(amount),
        ...(input.metric === 'cost' && (row.unpriced ?? 0) > 0 && { flag: { label: 'Unpriced', tone: 'warning' as const } }),
        ...(dimension.id === input.groupBy && { series: seriesOf(row.key) }),
      }
    })
    if (rest.length > 0) {
      const amount = rest.reduce((sum, row) => sum + amountOf(row, input.metric), 0)
      leaves.push({ id: REST_ID, label: `${String(rest.length)} more`, amount, share: shareOf(amount) })
    }
    return [{ id: dimension.id, label: dimension.label, icon: dimension.icon, leaves }]
  })
}

const formatDay = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export const UsageSpendMap = (props: {
  readonly view: ChartView
  readonly range: { readonly from: number; readonly to: number }
  readonly groupBy: ChartQuery['groupBy']
  readonly onGroupBy: (groupBy: ChartQuery['groupBy']) => void
  readonly onShowRequests: (search: string, groupBy: ChartQuery['groupBy']) => void
}): JSX.Element => {
  const [metric, setMetric] = useState<SpendMetric>('cost')
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
      metric={metric}
      metrics={METRICS}
      onDimensionChange={id => {
        if (isGroupBy(id)) props.onGroupBy(id)
        setLeafId(null)
      }}
      onLeafChange={setLeafId}
      onMetricChange={value => {
        if (isMetric(value)) setMetric(value)
      }}
      owner={props.view.appliedProvider ?? 'All accounts'}
      period={period}
      total={total}
    />
  )
}
