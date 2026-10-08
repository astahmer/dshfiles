import { Chart, ChartFrame, colorLegend, defineChart, lineY, scaleLinear, tooltip } from '@dshfiles/plugin-ui/chart'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo } from 'react'
import type { UsageHistoryPoint } from './api.js'
import { quotaHistoryRows } from './usage-history-analysis.js'

const CHART_POINT_LIMIT = 500

const formatAxisTime = (value: number): string =>
  new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Remaining quota over time: one colour per provider window, broken into one
 * line per reset cycle so a reset never draws as a steep climb.
 */
export const QuotaHistoryChart = (props: {
  readonly points: readonly UsageHistoryPoint[]
  readonly ariaLabel: string
  readonly emptyMessage: string
  readonly height: number
  readonly className?: string
}): JSX.Element => {
  const rows = useMemo(() => quotaHistoryRows(props.points, CHART_POINT_LIMIT), [props.points])
  const windows = useMemo(() => [...new Set(rows.map(row => row.window))], [rows])
  const definition = useMemo(
    () =>
      defineChart({
        marks: [lineY(rows, { x: 'at', y: 'percent', z: 'cycle', color: 'window', points: true, strokeWidth: 1.5 })],
        scales: {
          x: { scale: scaleLinear, axis: { ticks: { count: 4, format: formatAxisTime } } },
          y: { scale: scaleLinear().domain([0, 100]), grid: true, axis: { ticks: { count: 5, format: value => `${String(value)}%` } } },
        },
        color: { domain: windows, legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
          use: tooltip,
          format: point => `${point.datum.window}: ${String(point.datum.percent)}% remaining · ${new Date(point.datum.at).toLocaleString()}`,
        },
      }),
    [rows, windows],
  )
  if (props.points.length < 2 || rows.length === 0) {
    return (
      <Empty className="dshx:flex-none dshx:gap-2 dshx:border dshx:p-4 dshx:md:p-4">
        <EmptyDescription className="dshx:text-xs">{props.emptyMessage}</EmptyDescription>
      </Empty>
    )
  }
  return (
    <ChartFrame className={cn('dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3', props.className)}>
      <Chart
        ariaDescription={`Percent remaining per window: ${windows.join(', ')}.`}
        ariaLabel={props.ariaLabel}
        definition={definition}
        height={props.height}
      />
    </ChartFrame>
  )
}
