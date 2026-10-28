import { Chart, ChartFrame, barY, colorLegend, defineChart, lineY, scaleBand, scaleLinear, scalePoint, tooltip } from '@dshfiles/plugin-ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useMemo, type ReactNode } from 'react'
import { usageApi, type ChartQuery, type ChartView } from './api.js'
import { UsageBucketsModel } from './buckets.js'
import { JevUsageCard } from './jev-usage-card.js'
import type { RequestPurpose } from './fold.js'
import { UsageFormattingModel, type OpenThread } from './format.js'

const DAY_MS = UsageBucketsModel.DAY_MS
const CHART_HEIGHT = 220
const TOKEN_KINDS = ['Input', 'Cache read', 'Cache write', 'Output'] as const

/** Purpose ids arrive as series keys; the legend and tooltips show their product names. */
const purposeLabelsByKey = new Map(Object.entries(UsageFormattingModel.purposeLabels))

const Panel = (props: { readonly title: string; readonly description?: string; readonly className?: string; readonly children: ReactNode }): JSX.Element => (
  <ChartFrame title={props.title} description={props.description} className={cn('dshx:rounded-lg dshx:border dshx:p-3', props.className)}>
    {props.children}
  </ChartFrame>
)

const Tile = (props: { readonly label: string; readonly value: string; readonly detail?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:px-3 dshx:py-2">
    <span className="dshx:text-[11px] dshx:tracking-wide dshx:text-muted-foreground dshx:uppercase">{props.label}</span>
    <span className="dshx:text-base dshx:font-semibold dshx:tabular-nums">{props.value}</span>
    {props.detail === undefined ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{props.detail}</span>}
  </div>
)

const Change = (props: { readonly current: number; readonly previous: number }): JSX.Element => {
  const ratio = UsageFormattingModel.changeRatio(props.current, props.previous)
  if (ratio === null) return <>no earlier usage to compare</>
  const up = ratio >= 0
  return (
    <span className={up ? 'dshx:text-warning' : 'dshx:text-success'}>
      {up ? '▲' : '▼'} {Math.abs(ratio) >= 10 ? `${String(Math.round(ratio + 1))}×` : UsageFormattingModel.formatPercent(Math.abs(ratio))} vs previous period
    </span>
  )
}

const Breakdown = (props: {
  readonly title: string
  readonly rows: ChartView['breakdown']['model']
  readonly onSelect: (key: string) => void
}): JSX.Element => {
  const top = props.rows.slice(0, 8)
  const max = Math.max(...top.map(row => row.cost), 0)
  return (
    <Panel title={props.title} description="Select a row to see its requests.">
      {top.length === 0 ? (
        <p className="dshx:text-xs">No requests.</p>
      ) : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {top.map(row => (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => props.onSelect(row.key)}
                className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-0.5 dshx:rounded dshx:px-1 dshx:py-0.5 dshx:text-left dshx:hover:bg-accent"
              >
                <span className="dshx:flex dshx:justify-between dshx:gap-2 dshx:text-xs dshx:text-foreground">
                  <span className="dshx:truncate">{row.key}</span>
                  <span className="dshx:shrink-0 dshx:tabular-nums">
                    {UsageFormattingModel.formatCost(row.cost)} · {row.requests.toLocaleString()} req
                  </span>
                </span>
                <span className="dshx:h-1.5 dshx:w-full dshx:rounded-full dshx:bg-muted">
                  <span
                    className="dshx:block dshx:h-full dshx:rounded-full dshx:bg-chart-1"
                    style={{ width: `${max === 0 ? 0 : Math.max(2, (row.cost / max) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export const UsageCharts = (props: {
  readonly range: { readonly from: number; readonly to: number }
  readonly purposes: readonly RequestPurpose[] | undefined
  readonly bucket: 'hour' | 'day'
  readonly groupBy: ChartQuery['groupBy']
  readonly onGroupBy: (groupBy: ChartQuery['groupBy']) => void
  readonly onShowRequests: (search: string) => void
  readonly openThread: OpenThread
}): JSX.Element => {
  const api = useApi(usageApi)
  const tzOffsetMinutes = -new Date(props.range.from).getTimezoneOffset()
  const query: ChartQuery = {
    from: props.range.from,
    to: props.range.to,
    ...(props.purposes === undefined ? {} : { purposes: [...props.purposes] }),
    bucket: props.bucket,
    groupBy: props.groupBy,
    tzOffsetMinutes,
  }
  const charts = useQuery({
    queryKey: ['dshfiles-usage', 'charts', query],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.charts(query, { signal: hostSignal }) }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry: 1,
  })
  const now = new Date()
  const jevRange = {
    from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  }
  const jevUsage = useQuery({
    queryKey: ['dshfiles-usage', 'jev', jevRange.from],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.jevUsage(jevRange, { signal: hostSignal }) }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: 1,
  })
  const view = charts.data

  const series = useMemo(() => {
    const keyOf = (key: string): string => (props.groupBy === 'purpose' ? (purposeLabelsByKey.get(key) ?? key) : key)
    const starts = [
      ...new Set([
        ...UsageBucketsModel.bucketStarts({ from: props.range.from, to: props.range.to, bucket: props.bucket, offsetMs: tzOffsetMinutes * 60_000 }),
        ...(view?.buckets ?? []).map(row => row.start),
        ...(view?.latency ?? []).map(row => row.start),
      ]),
    ].sort((left, right) => left - right)
    const labels = starts.map(start => UsageBucketsModel.bucketKey(start))
    const labelOf = new Map(starts.map((start, index) => [start, labels[index] ?? '']))
    const buckets = view?.buckets ?? []
    // Band scales take their domain from the rows, so every bucket gets a zero row and empty days keep their slot.
    const firstKey = view?.keys[0] ?? ''
    const missing = (rows: readonly { readonly label: string }[]): string[] => {
      const present = new Set(rows.map(row => row.label))
      return labels.filter(label => !present.has(label))
    }
    const cost = buckets.filter(row => row.cost > 0).map(row => ({ label: labelOf.get(row.start) ?? '', key: keyOf(row.key), cost: row.cost }))
    cost.push(...missing(cost).map(label => ({ label, key: firstKey, cost: 0 })))
    const totals = new Map<number, { input: number; cacheRead: number; cacheWrite: number; output: number; requests: number; failed: number }>()
    for (const row of buckets) {
      const total = totals.get(row.start) ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0, failed: 0 }
      total.input += row.input
      total.cacheRead += row.cacheRead
      total.cacheWrite += row.cacheWrite
      total.output += row.output
      total.requests += row.requests
      total.failed += row.failed
      totals.set(row.start, total)
    }
    const tokens = [...totals.entries()].flatMap(([start, total]) => {
      const label = labelOf.get(start) ?? ''
      return [
        { label, kind: 'Input', tokens: total.input },
        { label, kind: 'Cache read', tokens: total.cacheRead },
        { label, kind: 'Cache write', tokens: total.cacheWrite },
        { label, kind: 'Output', tokens: total.output },
      ].filter(row => row.tokens > 0)
    })
    tokens.push(...missing(tokens).map(label => ({ label, kind: 'Input', tokens: 0 })))
    const cache = [...totals.entries()].flatMap(([start, total]) => {
      const ratio = UsageFormattingModel.cacheHitRatio(total)
      return ratio === null ? [] : [{ label: labelOf.get(start) ?? '', percent: Math.round(ratio * 1000) / 10 }]
    })
    const requests = [...totals.entries()].flatMap(([start, total]) => [
      { label: labelOf.get(start) ?? '', outcome: 'Succeeded or aborted', count: total.requests - total.failed },
      { label: labelOf.get(start) ?? '', outcome: 'Failed', count: total.failed },
    ])
    requests.push(...missing(requests).map(label => ({ label, outcome: 'Succeeded or aborted', count: 0 })))
    const latency = (view?.latency ?? []).flatMap(row => {
      const label = labelOf.get(row.start) ?? ''
      return [
        { label, metric: 'TTFT p50', ms: row.ttftP50 },
        { label, metric: 'TTFT p90', ms: row.ttftP90 },
        { label, metric: 'Duration p50', ms: row.durationP50 },
        { label, metric: 'Duration p90', ms: row.durationP90 },
      ].flatMap(entry => (entry.ms === null ? [] : [{ label: entry.label, metric: entry.metric, ms: entry.ms }]))
    })
    const order = new Map(labels.map((label, index) => [label, index]))
    const byTime = (left: { readonly label: string }, right: { readonly label: string }): number => (order.get(left.label) ?? 0) - (order.get(right.label) ?? 0)
    return { labels, cost: cost.sort(byTime), tokens: tokens.sort(byTime), cache, requests: requests.sort(byTime), latency }
  }, [view, props.range.from, props.range.to, props.bucket, props.groupBy, tzOffsetMinutes])

  const xAxis = useMemo(
    () => ({
      scale: () => scaleBand<string>().domain(series.labels).padding(0.2),
      axis: {
        ticks: {
          format: (value: string) =>
            UsageBucketsModel.sparseTickFormat(series.labels)(value) === ''
              ? ''
              : UsageBucketsModel.bucketKeyLabel(value, props.bucket, props.range.to - props.range.from > DAY_MS),
        },
      },
    }),
    [series.labels, props.bucket, props.range.from, props.range.to],
  )
  const pointAxis = useMemo(
    () => ({
      scale: () => scalePoint<string>().domain(series.labels).padding(0.5),
      axis: {
        ticks: {
          format: (value: string) =>
            UsageBucketsModel.sparseTickFormat(series.labels)(value) === ''
              ? ''
              : UsageBucketsModel.bucketKeyLabel(value, props.bucket, props.range.to - props.range.from > DAY_MS),
        },
      },
    }),
    [series.labels, props.bucket, props.range.from, props.range.to],
  )

  const costChart = useMemo(
    () =>
      defineChart({
        marks: [barY(series.cost, { x: 'label', y: 'cost', color: 'key' })],
        scales: {
          x: xAxis,
          y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4, format: value => UsageFormattingModel.formatCost(Number(value)) } } },
        },
        color: {
          domain: (view?.keys ?? []).map(key => (props.groupBy === 'purpose' ? (purposeLabelsByKey.get(key) ?? key) : key)),
          legend: colorLegend({ placement: 'bottom' }),
        },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, props.bucket, props.range.to - props.range.from > DAY_MS)} · ${point.datum.key}: ${UsageFormattingModel.formatCost(point.datum.cost)}`,
        },
      }),
    [series.cost, xAxis, view?.keys, props.groupBy, props.bucket, props.range.from, props.range.to],
  )
  const tokenChart = useMemo(
    () =>
      defineChart({
        marks: [barY(series.tokens, { x: 'label', y: 'tokens', color: 'kind' })],
        scales: {
          x: xAxis,
          y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4, format: value => UsageFormattingModel.formatCount(Number(value)) } } },
        },
        color: { domain: [...TOKEN_KINDS], legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, props.bucket, props.range.to - props.range.from > DAY_MS)} · ${point.datum.kind}: ${UsageFormattingModel.formatCount(point.datum.tokens)}`,
        },
      }),
    [series.tokens, xAxis, props.bucket, props.range.from, props.range.to],
  )
  const cacheChart = useMemo(
    () =>
      defineChart({
        marks: [lineY(series.cache, { x: 'label', y: 'percent', points: true, strokeWidth: 1.5 })],
        scales: { x: pointAxis, y: { scale: scaleLinear().domain([0, 100]), grid: true, axis: { ticks: { count: 5, format: value => `${String(value)}%` } } } },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, props.bucket, props.range.to - props.range.from > DAY_MS)}: ${String(point.datum.percent)}% of prompt tokens from cache`,
        },
      }),
    [series.cache, pointAxis, props.bucket, props.range.from, props.range.to],
  )
  const requestChart = useMemo(
    () =>
      defineChart({
        marks: [barY(series.requests, { x: 'label', y: 'count', color: 'outcome' })],
        scales: { x: xAxis, y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4 } } } },
        color: { domain: ['Succeeded or aborted', 'Failed'], range: ['var(--ts-chart-1)', 'var(--ts-chart-4)'], legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, props.bucket, props.range.to - props.range.from > DAY_MS)} · ${point.datum.outcome}: ${String(point.datum.count)}`,
        },
      }),
    [series.requests, xAxis, props.bucket, props.range.from, props.range.to],
  )
  const latencyChart = useMemo(
    () =>
      defineChart({
        marks: [lineY(series.latency, { x: 'label', y: 'ms', z: 'metric', color: 'metric', points: true, strokeWidth: 1.5 })],
        scales: {
          x: pointAxis,
          y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4, format: value => UsageFormattingModel.formatDuration(Number(value)) } } },
        },
        color: { domain: ['TTFT p50', 'TTFT p90', 'Duration p50', 'Duration p90'], legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, props.bucket, props.range.to - props.range.from > DAY_MS)} · ${point.datum.metric}: ${UsageFormattingModel.formatDuration(point.datum.ms)}`,
        },
      }),
    [series.latency, pointAxis, props.bucket, props.range.from, props.range.to],
  )

  if (charts.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(charts.error, 'Charts could not be loaded.')}</p>
  if (view === undefined) return <p className="dshx:text-xs dshx:text-muted-foreground">Loading…</p>

  const summary = view.summary
  const tokens = summary.input + summary.cacheRead + summary.cacheWrite + summary.output
  const days = Math.max(1, (Math.min(Date.now(), props.range.to) - props.range.from) / DAY_MS)
  const cacheHit = UsageFormattingModel.cacheHitRatio(summary)

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:md:grid-cols-3 dshx:xl:grid-cols-4">
        <Tile
          label="Cost (estimate)"
          value={UsageFormattingModel.formatCost(summary.cost)}
          detail={<Change current={summary.cost} previous={summary.previous.cost} />}
        />
        <Tile
          label="Per day"
          value={UsageFormattingModel.formatCost(summary.cost / days)}
          detail={summary.unpriced === 0 ? 'all routes priced' : `${summary.unpriced.toLocaleString()} requests unpriced`}
        />
        <Tile label="Requests" value={summary.requests.toLocaleString()} detail={<Change current={summary.requests} previous={summary.previous.requests} />} />
        <Tile
          label="Failed / aborted"
          value={`${summary.failed.toLocaleString()} / ${summary.aborted.toLocaleString()}`}
          detail={UsageFormattingModel.formatPercent(summary.requests === 0 ? null : summary.failed / summary.requests)}
        />
        <Tile label="Tokens" value={UsageFormattingModel.formatCount(tokens)} detail={<Change current={tokens} previous={summary.previous.tokens} />} />
        <Tile
          label="Cache hit"
          value={UsageFormattingModel.formatPercent(cacheHit)}
          detail={`${UsageFormattingModel.formatCount(summary.cacheRead)} cached prompt tokens`}
        />
        <Tile
          label="Cache savings (estimate)"
          value={UsageFormattingModel.formatCost(summary.cacheSavings)}
          detail={
            cacheHit === null
              ? 'no prompt token read from cache'
              : `${UsageFormattingModel.formatPercent(cacheHit)} of prompt tokens billed at the cache-read rate${summary.unpriced === 0 ? '' : ' · priced routes only'}`
          }
        />
        <Tile
          label="Cost per turn"
          value={summary.turns === 0 ? '–' : UsageFormattingModel.formatCost(summary.cost / summary.turns)}
          detail={summary.turns === 0 ? 'no turn recorded' : `${summary.turns.toLocaleString()} turns · ${summary.requests.toLocaleString()} requests`}
        />
      </div>

      <div data-usage-jev-card>
        <JevUsageCard usage={jevUsage.data} error={jevUsage.error} failed={jevUsage.isError} />
      </div>

      <Panel title="Cost over time" description="List-price estimate, stacked by the largest series.">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Stack cost by"
          value={props.groupBy}
          onValueChange={value => {
            if (value === 'model' || value === 'provider' || value === 'project') props.onGroupBy(value)
          }}
          className="dshx:self-start"
        >
          <ToggleGroupItem value="model">Model</ToggleGroupItem>
          <ToggleGroupItem value="provider">Provider</ToggleGroupItem>
          <ToggleGroupItem value="project">Project</ToggleGroupItem>
          <ToggleGroupItem value="purpose">Purpose</ToggleGroupItem>
        </ToggleGroup>
        <Chart
          ariaLabel="Cost over time"
          ariaDescription={`Cost per ${props.bucket}, stacked by ${props.groupBy}.`}
          definition={costChart}
          height={CHART_HEIGHT}
        />
      </Panel>

      <div className="dshx:grid dshx:gap-3 dshx:lg:grid-cols-3">
        <Breakdown title="Cost per model" rows={view.breakdown.model} onSelect={props.onShowRequests} />
        <Breakdown title="Cost per provider" rows={view.breakdown.provider} onSelect={props.onShowRequests} />
        <Breakdown title="Cost per project" rows={view.breakdown.project} onSelect={props.onShowRequests} />
      </div>

      <div className="dshx:grid dshx:gap-3 dshx:lg:grid-cols-2">
        <Panel title="Tokens" description="Uncached input, cache reads, cache writes and output.">
          <Chart ariaLabel="Tokens over time" ariaDescription="Token counts per bucket split by kind." definition={tokenChart} height={CHART_HEIGHT} />
        </Panel>
        <Panel title="Cache hit ratio" description="Share of prompt tokens read from cache.">
          <Chart
            ariaLabel="Cache hit ratio over time"
            ariaDescription="Percent of prompt tokens served from cache per bucket."
            definition={cacheChart}
            height={CHART_HEIGHT}
          />
        </Panel>
        <Panel title="Requests and failures">
          <Chart
            ariaLabel="Requests over time"
            ariaDescription="Request count per bucket, failed requests stacked on top."
            definition={requestChart}
            height={CHART_HEIGHT}
          />
        </Panel>
        <Panel title="Latency percentiles" description="Successful requests; TTFT is the first stream chunk after the step started.">
          <Chart
            ariaLabel="TTFT and duration percentiles"
            ariaDescription="p50 and p90 time to first token and duration per bucket."
            definition={latencyChart}
            height={CHART_HEIGHT}
          />
        </Panel>
      </div>

      <Panel title="Top threads by cost">
        {view.topThreads.length === 0 ? (
          <p className="dshx:text-xs">No requests.</p>
        ) : (
          <ol className="dshx:flex dshx:flex-col dshx:gap-0.5">
            {view.topThreads.map(thread => (
              <li key={thread.sessionId}>
                <button
                  type="button"
                  className="dshx:flex dshx:w-full dshx:justify-between dshx:gap-2 dshx:rounded dshx:px-1 dshx:py-1 dshx:text-left dshx:text-xs dshx:text-foreground dshx:hover:bg-accent"
                  onClick={() => props.openThread({ sessionId: thread.sessionId, parentSessionId: null })}
                >
                  <span className="dshx:min-w-0 dshx:truncate">
                    {thread.title ?? thread.sessionId}
                    {thread.project === null ? null : <span className="dshx:text-muted-foreground"> · {thread.project}</span>}
                  </span>
                  <span className="dshx:shrink-0 dshx:tabular-nums">
                    {UsageFormattingModel.formatCost(thread.cost)} · {thread.requests.toLocaleString()} req
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}
