import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Chart, ChartFrame, colorLegend, defineChart, lineY, scaleLinear, tooltip } from '@dshfiles/plugin-ui/chart'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { tracesQueries, type TracesClient } from './queries.js'
import { ServiceDot } from './trace-list.js'
import type { MetricSeries, MetricSummary } from './types.js'

const CHART_HEIGHT = 220

const formatNumber = (value: number | null): string => {
  if (value === null) return '—'
  if (Number.isInteger(value)) return value.toLocaleString()
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toPrecision(3)
}

const seriesLabel = (attributes: MetricSeries['series'][number]['attributes']): string => {
  const entries = Object.entries(attributes)
  return entries.length === 0 ? '(no attributes)' : entries.map(([key, value]) => `${key}=${TraceFormat.attribute(value)}`).join(', ')
}

const MetricChart = (props: { readonly series: MetricSeries; readonly t: TracesTranslate }): JSX.Element => {
  const points = useMemo(
    () =>
      props.series.series.flatMap(entry => entry.points.map(point => ({ timeMs: point.timeMs, value: point.value, series: seriesLabel(entry.attributes) }))),
    [props.series],
  )
  const labels = useMemo(() => [...new Set(points.map(point => point.series))], [points])
  // A delta export puts every series at one instant; pad the axis so a single time still reads as a time.
  const timeDomain = useMemo((): [number, number] => {
    const times = points.map(point => point.timeMs)
    const first = Math.min(...times)
    const last = Math.max(...times)
    const pad = Math.max(30_000, (last - first) * 0.05)
    return [first - pad, last + pad]
  }, [points])
  const definition = useMemo(
    () =>
      defineChart({
        marks: [lineY(points, { x: 'timeMs', y: 'value', z: 'series', color: 'series', points: true, strokeWidth: 1.5 })],
        scales: {
          x: { scale: scaleLinear().domain(timeDomain), axis: { ticks: { count: 4, format: value => TraceFormat.clock(Number(value)) } } },
          y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4, format: value => formatNumber(Number(value)) } } },
        },
        color: { domain: labels, legend: colorLegend({ placement: 'bottom' }) },
        tooltip: { use: tooltip, format: point => `${TraceFormat.clock(point.datum.timeMs)} · ${point.datum.series}: ${formatNumber(point.datum.value)}` },
      }),
    [points, labels, timeDomain],
  )
  const kind =
    props.series.valueKind === 'increase' ? props.t('metricIncrease') : props.series.valueKind === 'mean' ? props.t('metricMean') : props.t('metricValue')
  return (
    <ChartFrame
      title={`${props.series.name}${props.series.unit === null ? '' : ` (${props.series.unit})`}`}
      description={[props.series.service, kind, props.series.description].filter(Boolean).join(' · ')}
      className="dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:p-3"
    >
      {points.length === 0 ? (
        <p className="dshx:text-xs">{props.t('metricNoPoints')}</p>
      ) : (
        <Chart ariaLabel={`${props.t('metricChart')} ${props.series.name}`} ariaDescription={kind} definition={definition} height={CHART_HEIGHT} />
      )}
      {props.series.truncatedSeries > 0 ? (
        <p className="dshx:text-xs">
          +{props.series.truncatedSeries} {props.t('metricMoreSeries')}
        </p>
      ) : null}
    </ChartFrame>
  )
}

export const MetricsView = (props: { readonly client: TracesClient; readonly windowMinutes: number; readonly t: TracesTranslate }): JSX.Element => {
  const t = props.t
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ readonly service: string; readonly name: string } | null>(null)
  const debounced = useDebouncedValue({ value: search.trim(), delayMs: 250 })
  const listQuery = useQuery({ ...tracesQueries.metrics(props.client, props.windowMinutes, debounced), placeholderData: keepPreviousData })
  const metrics = listQuery.data?.metrics ?? []
  const current: MetricSummary | undefined =
    metrics.find(metric => metric.service === selected?.service && metric.name === selected.name) ?? (selected === null ? metrics[0] : undefined)
  const seriesQuery = useQuery({
    ...tracesQueries.metric(props.client, { name: current?.name ?? '', service: current?.service ?? '', windowMinutes: props.windowMinutes }),
    enabled: current !== undefined,
    placeholderData: keepPreviousData,
  })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <SearchInput
        className="dshx:w-72 dshx:max-w-full dshx:@max-pane-narrow:w-full"
        aria-label={t('searchMetrics')}
        placeholder={t('searchMetricsPlaceholder')}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(listQuery.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {metrics.length === 0 && listQuery.isSuccess ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noMetrics')}</p> : null}
      {current === undefined ? null : seriesQuery.data === undefined ? null : <MetricChart series={seriesQuery.data} t={t} />}
      {metrics.length === 0 ? null : (
        <Table aria-label={t('tabMetrics')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('metricName')}</TableHead>
              <TableHead className="dshx:w-28 dshx:@max-pane-narrow:hidden">{t('metricType')}</TableHead>
              <TableHead className="dshx:w-16 dshx:text-right dshx:@max-pane-compact:hidden">{t('metricSeriesCount')}</TableHead>
              <TableHead className="dshx:w-24 dshx:text-right">{t('metricLast')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map(metric => {
              const active = current?.service === metric.service && current.name === metric.name
              return (
                <TableRow
                  key={`${metric.service}\u0000${metric.name}`}
                  data-metric={metric.name}
                  aria-selected={active}
                  tabIndex={0}
                  className={cn('dshx:cursor-pointer', active ? 'dshx:bg-accent' : '')}
                  onClick={() => setSelected({ service: metric.service, name: metric.name })}
                  onKeyDown={event => {
                    if (event.key === 'Enter') setSelected({ service: metric.service, name: metric.name })
                  }}
                >
                  <TableCell className="dshx:max-w-0">
                    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                      <ServiceDot service={metric.service} />
                      <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{metric.service}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{metric.name}</span>
                        </TooltipTrigger>
                        <TooltipContent>{metric.description ?? metric.name}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                  <TableCell className="dshx:@max-pane-narrow:hidden">
                    <Badge variant="muted">{metric.type}</Badge>
                  </TableCell>
                  <TableCell className="dshx:text-right dshx:font-mono dshx:text-xs dshx:@max-pane-compact:hidden">{metric.series}</TableCell>
                  <TableCell className="dshx:text-right dshx:font-mono dshx:text-xs">
                    {formatNumber(metric.lastValue)}
                    {metric.unit === null ? '' : ` ${metric.unit}`}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
