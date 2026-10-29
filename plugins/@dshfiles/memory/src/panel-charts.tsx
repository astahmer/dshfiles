import { Chart, ChartFrame, barY, colorLegend, defineChart, lineY, scaleBand, scaleLinear, scalePoint, tooltip } from '@dshfiles/plugin-ui/chart'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import type { LucideIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

import { PanelFormat } from './panel-format.ts'

export type DayPoint = {
  readonly day: string
  readonly label: string
  readonly digests: number
  readonly searchFound: number
  readonly searchEmpty: number
  readonly readFound: number
  readonly readMissing: number
  readonly citations: number
  readonly agentCorrected: number
  readonly userCorrected: number
  readonly blockRequests: number
  readonly searchers: number
  readonly readers: number
  readonly digestUsd: number
  readonly jevCalls: number
  readonly jevUsd: number
}

/** A compact bar sparkline; empty days keep their slot so the shape matches the range. */
const Sparkline = (props: { readonly values: readonly number[]; readonly tone?: string | undefined }): JSX.Element => {
  const max = Math.max(...props.values, 1)
  return (
    <span aria-hidden className="dshx:flex dshx:h-8 dshx:items-end dshx:gap-[2px]">
      {props.values.map((value, index) => (
        <span
          key={index}
          className={cn('dshx:w-[3px] dshx:rounded-[1px] dshx:bg-primary/70', props.tone)}
          style={{ height: value === 0 ? '0%' : `${String(Math.max(Math.round((value / max) * 100), 8))}%` }}
        />
      ))}
    </span>
  )
}

export const StatCard = (props: {
  readonly label: string
  readonly value: string
  readonly detail?: ReactNode
  readonly Icon?: LucideIcon
  readonly iconTile?: string
  readonly spark?: readonly number[]
  readonly sparkTone?: string | undefined
  readonly hint?: string
}): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/60 dshx:p-3">
    <div className="dshx:flex dshx:items-start dshx:gap-2">
      {props.Icon === undefined ? null : (
        <span
          className={cn(
            'dshx:flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg',
            props.iconTile ?? 'dshx:bg-muted dshx:text-muted-foreground',
          )}
        >
          <props.Icon className="dshx:size-4" />
        </span>
      )}
      <span className="dshx:min-w-0 dshx:flex-1 dshx:text-[11px] dshx:leading-tight dshx:text-muted-foreground">{props.label}</span>
      {props.spark === undefined ? null : <Sparkline values={props.spark} tone={props.sparkTone} />}
    </div>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="dshx:text-xl dshx:font-semibold dshx:tabular-nums">{props.value}</span>
      </TooltipTrigger>
      {props.hint === undefined ? null : <TooltipContent>{props.hint}</TooltipContent>}
    </Tooltip>
    {props.detail === undefined ? null : <span className="dshx:min-h-4 dshx:text-[11px] dshx:text-muted-foreground">{props.detail}</span>}
  </div>
)

const ChartPanel = (props: {
  readonly heading: string
  readonly description: string
  readonly children: ReactNode
  readonly className?: string
}): JSX.Element => (
  <ChartFrame
    title={props.heading}
    description={props.description}
    className={cn('dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/60 dshx:p-3', props.className)}
  >
    {props.children}
  </ChartFrame>
)

const sparseTicks = (labels: readonly string[]): ((value: string) => string) => {
  const step = Math.max(1, Math.ceil(labels.length / 7))
  const shown = new Set(labels.filter((_, index) => index % step === 0 || index === labels.length - 1))
  return value => (shown.has(value) ? value : '')
}

export const DigestActivityChart = (props: { readonly points: readonly DayPoint[] }): JSX.Element => {
  const labels = props.points.map(point => point.label)
  const definition = defineChart({
    marks: [barY(props.points, { x: 'label', y: 'digests' })],
    scales: {
      x: { scale: () => scaleBand<string>().domain(labels).padding(0.35), axis: { ticks: { format: sparseTicks(labels) } } },
      y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4 } } },
    },
    tooltip: { use: tooltip, format: point => `${point.datum.label}: ${String(point.datum.digests)} digest${point.datum.digests === 1 ? '' : 's'}` },
  })
  return (
    <ChartPanel heading="Digest activity" description="Number of thread digests per day.">
      <Chart ariaLabel="Digest activity" ariaDescription="Thread digests per day." definition={definition} height={220} />
    </ChartPanel>
  )
}

const retrievalKinds = ['Search found', 'Search empty', 'Read found', 'Read missing'] as const

export const RetrievalChart = (props: { readonly points: readonly DayPoint[] }): JSX.Element => {
  const labels = props.points.map(point => point.label)
  const rows = props.points.flatMap(point => [
    { label: point.label, kind: retrievalKinds[0], count: point.searchFound },
    { label: point.label, kind: retrievalKinds[1], count: point.searchEmpty },
    { label: point.label, kind: retrievalKinds[2], count: point.readFound },
    { label: point.label, kind: retrievalKinds[3], count: point.readMissing },
  ])
  const definition = defineChart({
    marks: [barY(rows, { x: 'label', y: 'count', color: 'kind' })],
    scales: {
      x: { scale: () => scaleBand<string>().domain(labels).padding(0.25), axis: { ticks: { format: sparseTicks(labels) } } },
      y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4 } } },
    },
    color: {
      domain: [...retrievalKinds],
      range: ['var(--ts-chart-2)', 'var(--ts-chart-6)', 'var(--ts-chart-1)', 'var(--ts-chart-4)'],
      legend: colorLegend({ placement: 'bottom' }),
    },
    tooltip: { use: tooltip, format: point => `${point.datum.label} · ${point.datum.kind}: ${String(point.datum.count)}` },
  })
  return (
    <ChartPanel heading="Retrieval outcomes" description="Search and read results over time.">
      <Chart ariaLabel="Retrieval outcomes" ariaDescription="Memory search and read results per day." definition={definition} height={220} />
    </ChartPanel>
  )
}

export const CostChart = (props: { readonly points: readonly DayPoint[] }): JSX.Element => {
  const labels = props.points.map(point => point.label)
  const rows = props.points.flatMap(point => [
    { label: point.label, series: 'Digest', usd: point.digestUsd },
    { label: point.label, series: 'Jev', usd: point.jevUsd },
  ])
  const definition = defineChart({
    marks: [lineY(rows, { x: 'label', y: 'usd', z: 'series', color: 'series', points: true, strokeWidth: 1.5 })],
    scales: {
      x: { scale: () => scalePoint<string>().domain(labels).padding(0.4), axis: { ticks: { format: sparseTicks(labels) } } },
      y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4, format: value => PanelFormat.formatUsd(Number(value)) } } },
    },
    color: { domain: ['Digest', 'Jev'], range: ['var(--ts-chart-1)', 'var(--ts-chart-3)'], legend: colorLegend({ placement: 'bottom' }) },
    tooltip: { use: tooltip, format: point => `${point.datum.label} · ${point.datum.series}: ${PanelFormat.formatUsd(point.datum.usd)}` },
  })
  return (
    <ChartPanel heading="Cost over time" description="Estimated cost of digest calls.">
      <Chart ariaLabel="Memory cost over time" ariaDescription="Estimated memory cost per day." definition={definition} height={220} />
    </ChartPanel>
  )
}

/** A labelled progress row, shared by the recall and correctness cards. */
export const MetricBar = (props: {
  readonly label: string
  readonly value: number
  readonly max: number
  readonly detail: string
  readonly tone?: string
}): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-1">
    <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:text-xs">
      <span className="dshx:min-w-0 dshx:truncate">{props.label}</span>
      <span className="dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground">{props.detail}</span>
    </div>
    <span className="dshx:h-2 dshx:w-full dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
      <span
        className={cn('dshx:block dshx:h-full dshx:rounded-full dshx:bg-success', props.tone)}
        style={{ width: `${String(PanelFormat.formatCount(Math.min(100, props.max === 0 ? 0 : (props.value / props.max) * 100)))}%` }}
      />
    </span>
  </div>
)

export const recallPercent = (found: number, total: number): string => PanelFormat.formatPercent(total === 0 ? null : found / total)
