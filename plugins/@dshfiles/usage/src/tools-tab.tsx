import { Chart, barX, barY, colorLegend, defineChart, scaleBand, scaleLinear, tooltip } from '@dshfiles/plugin-ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, keepPreviousData, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useMemo, useState, type ReactNode } from 'react'
import { usageApi, type ActivityReport } from './api.js'
import { UsageBucketsModel } from './buckets.js'
import { UsageFormattingModel } from './format.js'

const TOOL_CATEGORIES = ['tool', 'skill', 'api', 'plugin', 'mcp', 'other'] as const
type ToolCategory = (typeof TOOL_CATEGORIES)[number]

const CATEGORY_LABELS = {
  tool: 'DSH tools',
  skill: 'Skills',
  api: 'Plugin API tools',
  plugin: 'Plugin tools',
  mcp: 'MCP tools',
  other: 'Other tools',
} satisfies Readonly<Record<ToolCategory, string>>

/** `Time by command` style bar row: a share of one measured total. */
const ShareBar = (props: { readonly label: string; readonly detail: string; readonly share: number; readonly max: number }): JSX.Element => (
  <li className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_auto] dshx:items-center dshx:gap-x-3 dshx:gap-y-1">
    <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{props.label}</span>
    <span className="dshx:text-xs dshx:text-muted-foreground">{props.detail}</span>
    <div className="dshx:col-span-2 dshx:h-1.5 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
      <div
        className="dshx:h-full dshx:rounded-full dshx:bg-primary"
        style={{ width: `${props.max === 0 ? 0 : Math.max(1, Math.round((props.share / props.max) * 100))}%` }}
      />
    </div>
  </li>
)

const Tile = (props: { readonly label: string; readonly value: string; readonly detail?: ReactNode }): JSX.Element => (
  <div className="dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2">
    <dt className="dshx:text-xs dshx:text-muted-foreground">{props.label}</dt>
    <dd className="dshx:mt-0.5 dshx:text-base dshx:font-semibold dshx:tabular-nums">{props.value}</dd>
    {props.detail === undefined ? null : <dd className="dshx:mt-0.5 dshx:text-[11px] dshx:text-muted-foreground">{props.detail}</dd>}
  </div>
)

const Panel = (props: { readonly title: string; readonly description?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-3">
    <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
      <h3 className="dshx:text-sm dshx:font-semibold">{props.title}</h3>
      {props.description === undefined ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{props.description}</span>}
    </div>
    {props.children}
  </section>
)

const CHART_HEIGHT = 190

const RANK_METRICS = ['calls', 'time', 'output'] as const
type RankMetric = (typeof RANK_METRICS)[number]

const METRIC_LABELS = { calls: 'Calls', time: 'Wall time', output: 'Output tokens' } satisfies Readonly<Record<RankMetric, string>>

const metricValue = (row: ActivityReport['tools'][number], metric: RankMetric): number =>
  metric === 'calls' ? row.calls : metric === 'time' ? row.totalDurationMs : row.outputTokens

const metricLabel = (metric: RankMetric, value: number): string =>
  metric === 'calls'
    ? `${value.toLocaleString()} calls`
    : metric === 'time'
      ? UsageFormattingModel.formatDuration(value)
      : `${UsageFormattingModel.formatCount(value)} tokens`

export const UsageToolsTab = (props: { readonly range: { readonly from: number; readonly to: number }; readonly bucket: 'hour' | 'day' }): JSX.Element => {
  const api = useApi(usageApi)
  const [metric, setMetric] = useState<RankMetric>('calls')
  const tzOffsetMinutes = -new Date(props.range.from).getTimezoneOffset()
  const query = useQuery({
    queryKey: ['dshfiles-usage', 'activity', props.range.from, props.range.to, props.bucket, tzOffsetMinutes],
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        request: hostSignal => api.activity({ ...props.range, bucket: props.bucket, tzOffsetMinutes, limit: 100, eventLimit: 25 }, { signal: hostSignal }),
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry: 1,
  })

  const report = query.data
  const tools = useMemo(() => [...(report?.tools ?? [])].sort((left, right) => metricValue(right, metric) - metricValue(left, metric)), [report?.tools, metric])
  const timeline = useMemo(() => report?.timeline ?? [], [report?.timeline])
  const categories = useMemo(() => {
    const present = new Set(timeline.map(row => row.category))
    return TOOL_CATEGORIES.filter(category => present.has(category))
  }, [timeline])
  const timelineBucket = report?.timelineBucket ?? props.bucket
  const labels = useMemo(() => {
    const starts = [
      ...new Set([
        ...UsageBucketsModel.bucketStarts({ from: props.range.from, to: props.range.to, bucket: timelineBucket, offsetMs: tzOffsetMinutes * 60_000 }),
        ...timeline.map(row => row.start),
      ]),
    ].sort((left, right) => left - right)
    return new Map(starts.map(start => [start, UsageBucketsModel.bucketKey(start)]))
  }, [props.range.from, props.range.to, timelineBucket, tzOffsetMinutes, timeline])

  const timelineRows = useMemo(() => {
    const rows = timeline
      .map(row => ({ label: labels.get(row.start) ?? '', category: CATEGORY_LABELS[row.category], calls: row.calls, outputTokens: row.outputTokens }))
      .filter(row => row.label !== '')
    // Every bucket keeps its slot, so a day without calls reads as empty instead of collapsing the axis.
    const present = new Set(rows.map(row => row.label))
    const filler = [...labels.values()].filter(label => !present.has(label))
    const firstCategory = rows[0]?.category
    if (firstCategory !== undefined) rows.push(...filler.map(label => ({ label, category: firstCategory, calls: 0, outputTokens: 0 })))
    const order = new Map([...labels.values()].map((label, index) => [label, index]))
    return rows.sort((left, right) => (order.get(left.label) ?? 0) - (order.get(right.label) ?? 0))
  }, [timeline, labels])
  const rankedRows = useMemo(
    () => tools.slice(0, 10).map(row => ({ name: row.name, value: metricValue(row, metric), category: CATEGORY_LABELS[row.category] })),
    [tools, metric],
  )

  const axisLabels = useMemo(() => [...new Set(timelineRows.map(row => row.label))], [timelineRows])
  const xAxis = useMemo(
    () => ({
      scale: () => scaleBand<string>().domain(axisLabels).padding(0.2),
      axis: {
        ticks: {
          format: (value: string) =>
            UsageBucketsModel.sparseTickFormat(axisLabels)(value) === ''
              ? ''
              : UsageBucketsModel.bucketKeyLabel(value, timelineBucket, props.range.to - props.range.from > UsageBucketsModel.DAY_MS),
        },
      },
    }),
    [axisLabels, timelineBucket, props.range.from, props.range.to],
  )
  const timelineChart = useMemo(
    () =>
      defineChart({
        marks: [barY(timelineRows, { x: 'label', y: 'calls', color: 'category' })],
        scales: {
          x: xAxis,
          y: { scale: scaleLinear, grid: true, axis: { ticks: { count: 4 } } },
        },
        color: { domain: categories.map(category => CATEGORY_LABELS[category]), legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
          use: tooltip,
          format: point =>
            `${UsageBucketsModel.bucketKeyLabel(point.datum.label, timelineBucket, props.range.to - props.range.from > UsageBucketsModel.DAY_MS)} · ${point.datum.category}: ${String(point.datum.calls)} calls`,
        },
      }),
    [timelineRows, xAxis, categories, timelineBucket, props.range.from, props.range.to],
  )
  const rankedChart = useMemo(
    () =>
      defineChart({
        marks: [barX(rankedRows, { x: 'value', y: 'name', color: 'category' })],
        scales: {
          x: {
            scale: scaleLinear,
            grid: true,
            axis: {
              ticks: {
                count: 4,
                format: value => (metric === 'time' ? UsageFormattingModel.formatDuration(Number(value)) : UsageFormattingModel.formatCount(Number(value))),
              },
            },
          },
          y: { scale: () => scaleBand<string>().paddingInner(0.15).paddingOuter(0.05) },
        },
        color: { domain: categories.map(category => CATEGORY_LABELS[category]), legend: colorLegend({ placement: 'bottom' }) },
        tooltip: { use: tooltip, format: point => `${point.datum.name} · ${point.datum.category}: ${metricLabel(metric, point.datum.value)}` },
      }),
    [rankedRows, metric, categories],
  )

  if (query.isPending) return <p className="dshx:text-sm dshx:text-muted-foreground">Loading tool activity…</p>
  if (query.isError) return <p className="dshx:text-sm dshx:text-destructive">{errorMessage(query.error, 'Could not load tool activity.')}</p>
  if (report === undefined) return <p className="dshx:text-sm dshx:text-muted-foreground">Loading tool activity…</p>
  const totals = report.totals
  const callsForCategory = (category: ToolCategory): number =>
    report.categoryOutcomes.length > 0
      ? (report.categoryOutcomes.find(row => row.category === category)?.calls ?? 0)
      : report.tools.filter(row => row.category === category).reduce((total, row) => total + row.calls, 0)
  const commandDistribution = report.commandDistribution ?? []
  const testRunDistribution = report.testRunDistribution ?? []
  const maxOutputCategory = Math.max(...report.categoryOutcomes.map(row => row.outputTokens), 0)

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-4">
      {totals === undefined ? null : (
        <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:md:grid-cols-3 dshx:xl:grid-cols-6">
          <Tile label="Tool calls" value={UsageFormattingModel.formatCount(totals.calls)} detail={`${report.tools.length.toLocaleString()} distinct tools`} />
          <Tile label="Success rate" value={UsageFormattingModel.formatPercent(totals.successRate)} detail={`${totals.errors.toLocaleString()} errors`} />
          <Tile
            label="Interrupted / unknown"
            value={`${totals.interrupted.toLocaleString()} / ${totals.unknown.toLocaleString()}`}
            detail={`${totals.pending.toLocaleString()} still running`}
          />
          <Tile
            label="Wall time"
            value={UsageFormattingModel.formatDuration(totals.durationMs)}
            detail={`${UsageFormattingModel.formatCount(totals.measuredCalls)} timed`}
          />
          <Tile
            label="Returned text"
            value={`${UsageFormattingModel.formatCount(totals.outputTokens)} tokens`}
            detail={`${UsageFormattingModel.formatCount(totals.measuredCalls)} of ${UsageFormattingModel.formatCount(totals.calls)} calls measured`}
          />
          <Tile
            label="Busiest category"
            value={
              report.categoryOutcomes.length === 0
                ? '–'
                : CATEGORY_LABELS[
                    TOOL_CATEGORIES.reduce((best, category) => (callsForCategory(category) > callsForCategory(best) ? category : best), TOOL_CATEGORIES[0])
                  ]
            }
            detail={
              report.categoryOutcomes.length === 0
                ? 'no tool calls'
                : `${UsageFormattingModel.formatCount(Math.max(...TOOL_CATEGORIES.map(callsForCategory)))} calls`
            }
          />
        </dl>
      )}

      <div className="dshx:grid dshx:items-start dshx:gap-3 dshx:lg:grid-cols-2">
        <Panel title="Tool calls over time" description={`${report.timelineBucket === 'hour' ? 'Hourly' : 'Daily'} calls stacked by category.`}>
          {timelineRows.length === 0 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No tool executions in this range.</p>
          ) : (
            <Chart
              ariaLabel="Tool calls over time"
              ariaDescription="Tool calls per bucket stacked by source category."
              definition={timelineChart}
              height={CHART_HEIGHT}
            />
          )}
        </Panel>
        <Panel title="Most-used tools" description="Top 10 by the selected metric; returned tokens are text characters / 4.">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Rank tools by"
            value={metric}
            onValueChange={value => {
              if (value === 'calls' || value === 'time' || value === 'output') setMetric(value)
            }}
            className="dshx:self-start"
          >
            {RANK_METRICS.map(key => (
              <ToggleGroupItem key={key} value={key}>
                {METRIC_LABELS[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {rankedRows.length === 0 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No tool executions in this range.</p>
          ) : (
            <Chart
              ariaLabel="Most-used tools"
              ariaDescription={`Top ten tools by ${METRIC_LABELS[metric]}.`}
              definition={rankedChart}
              height={rankedRows.length * 22 + 40}
            />
          )}
        </Panel>
      </div>

      <Panel title="Output by category" description="Estimated tokens each source returned, against the busiest source.">
        {report.categoryOutcomes.length === 0 ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">No measured tool output in this range.</p>
        ) : (
          <ol className="dshx:flex dshx:flex-col dshx:gap-2">
            {[...report.categoryOutcomes]
              .sort((left, right) => right.outputTokens - left.outputTokens)
              .map(row => (
                <ShareBar
                  key={row.category}
                  label={CATEGORY_LABELS[row.category]}
                  detail={`${UsageFormattingModel.formatCount(row.outputTokens)} tokens · ${row.calls.toLocaleString()} calls · ${UsageFormattingModel.formatPercent(row.successRate)} ok`}
                  share={row.outputTokens}
                  max={maxOutputCategory}
                />
              ))}
          </ol>
        )}
        <p className="dshx:text-[11px] dshx:text-muted-foreground">
          Only the size of a tool result is recorded (text characters), never its content; a call with no result size predates this measurement.
        </p>
      </Panel>

      <div className="dshx:grid dshx:gap-3 dshx:lg:grid-cols-2">
        <Panel title="Time by command" description="Normalized executable and subcommand.">
          {commandDistribution.length === 0 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No safely identifiable command timings in this range.</p>
          ) : (
            <ol className="dshx:flex dshx:flex-col dshx:gap-2">
              {commandDistribution.map(row => (
                <ShareBar
                  key={row.command}
                  label={row.command}
                  detail={`${UsageFormattingModel.formatDuration(row.totalDurationMs)} · ${row.calls} calls`}
                  share={row.totalDurationMs}
                  max={Math.max(...commandDistribution.map(entry => entry.totalDurationMs), 0)}
                />
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Time by test runner" description="Recognized runners; outcomes are shell-call status, not parsed test output.">
          {testRunDistribution.length === 0 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No recognized test-run timings in this range.</p>
          ) : (
            <ol className="dshx:flex dshx:flex-col dshx:gap-2">
              {testRunDistribution.map(row => (
                <ShareBar
                  key={row.runner}
                  label={row.runner}
                  detail={`${UsageFormattingModel.formatDuration(row.totalDurationMs)} · ${row.calls} calls · ${row.errors} errors · ${row.interrupted} interrupted`}
                  share={row.totalDurationMs}
                  max={Math.max(...testRunDistribution.map(entry => entry.totalDurationMs), 0)}
                />
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <Panel title="Every tool" description="Calls, outcomes, returned tokens and recorded latency.">
        {report.tools.length === 0 ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">No tool executions in this range.</p>
        ) : (
          <div className="dshx:overflow-x-auto">
            <table className="dshx:w-full dshx:text-left dshx:text-sm">
              <thead>
                <tr className="dshx:border-b dshx:border-border dshx:text-xs dshx:text-muted-foreground">
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Category
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Owner
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Tool or skill
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Calls
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Succeeded
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Errors
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Output tokens
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Avg / p90
                  </th>
                  <th scope="col" className="dshx:py-2">
                    Last used
                  </th>
                </tr>
              </thead>
              <tbody>
                {tools.map(row => (
                  <tr key={`${row.category}:${row.owner ?? ''}:${row.name}`} className="dshx:border-b dshx:border-border/60">
                    <td className="dshx:py-2 dshx:pr-3">{CATEGORY_LABELS[row.category]}</td>
                    <td className="dshx:py-2 dshx:pr-3 dshx:text-xs">{row.owner ?? '—'}</td>
                    <th scope="row" className="dshx:py-2 dshx:pr-3 dshx:font-mono dshx:text-xs">
                      {row.name}
                    </th>
                    <td className="dshx:py-2 dshx:pr-3">{row.calls.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">
                      {row.successes.toLocaleString()} ({UsageFormattingModel.formatPercent(row.successRate ?? null)})
                    </td>
                    <td className="dshx:py-2 dshx:pr-3">{row.errors.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3 dshx:tabular-nums">
                      {row.outputTokens === 0 ? '—' : UsageFormattingModel.formatCount(row.outputTokens)}
                      {row.measuredCalls < row.calls ? (
                        <span className="dshx:text-muted-foreground">
                          {' '}
                          ({row.measuredCalls}/{row.calls})
                        </span>
                      ) : null}
                    </td>
                    <td className="dshx:py-2 dshx:pr-3 dshx:text-xs">
                      {UsageFormattingModel.formatDuration(row.durationMs?.averageMs ?? row.averageDurationMs)} /{' '}
                      {UsageFormattingModel.formatDuration(row.durationMs?.p90Ms ?? null)}
                    </td>
                    <td className="dshx:py-2 dshx:text-xs">
                      {row.timestamps?.lastStarted == null ? '—' : new Date(row.timestamps.lastStarted).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dshx:text-[11px] dshx:text-muted-foreground">
          Arguments, outputs, commands, paths and raw errors are never copied into this report. Times are wall clock and parallel calls can overlap.
        </p>
      </Panel>

      <Panel title="Jev requests" description="Calls Backlog and Memory record through the Jev usage ledger.">
        <p className="dshx:text-sm dshx:text-muted-foreground">
          {report.jev.calls.toLocaleString()} calls · {report.jev.successes.toLocaleString()} succeeded · {report.jev.failures.toLocaleString()} failed ·{' '}
          {UsageFormattingModel.formatPercent(report.jev.successRate ?? null)} success · avg {UsageFormattingModel.formatDuration(report.jev.averageDurationMs)}{' '}
          · p90 {UsageFormattingModel.formatDuration(report.jev.durationMs?.p90Ms ?? null)} · {report.jev.inputTokens.toLocaleString()} input /{' '}
          {report.jev.outputTokens.toLocaleString()} output tokens
        </p>
        {report.jev.bySource.length > 0 && (
          <ul className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
            {report.jev.bySource.map(row => (
              <li key={row.source}>
                {row.source}: {row.calls} calls, {UsageFormattingModel.formatPercent(row.successRate)} success, p90{' '}
                {UsageFormattingModel.formatDuration(row.durationMs.p90Ms)}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {report.events.length === 0 ? null : (
        <Panel title="Recent events">
          <ol className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">
            {report.events.map((event, index) => (
              <li key={`${event.kind}:${event.at}:${index}`} className="dshx:flex dshx:flex-wrap dshx:gap-x-2 dshx:text-muted-foreground">
                <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time>
                <span className="dshx:text-foreground">
                  {event.kind === 'jev' ? `Jev (${event.source})` : `${event.name} (${CATEGORY_LABELS[event.category]})`}
                </span>
                <span>{event.outcome}</span>
                {event.durationMs !== null && <span>{UsageFormattingModel.formatDuration(event.durationMs)}</span>}
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  )
}
