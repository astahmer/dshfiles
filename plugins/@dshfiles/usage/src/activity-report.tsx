import { useApi } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { usageApi } from './api.js'
import type { ToolCategory } from './fold.js'

const TOOL_CATEGORIES: readonly ToolCategory[] = ['skill', 'api', 'plugin', 'mcp', 'tool', 'other']

const TOOL_CATEGORY_LABELS = {
  skill: 'Skills',
  api: 'Plugin API tools',
  plugin: 'Plugin tools',
  mcp: 'MCP tools',
  tool: 'DSH tools',
  other: 'Other tools',
} satisfies Readonly<Record<ToolCategory, string>>

const formatDuration = (duration: number | null): string =>
  duration === null ? '—' : duration < 1_000 ? `${duration} ms` : `${(duration / 1_000).toFixed(1)} s`

type TimeDistributionItem = { readonly identifier: string; readonly calls: number; readonly totalDurationMs: number; readonly detail?: string }

const TimeDistribution = (props: {
  readonly heading: string
  readonly emptyLabel: string
  readonly rows: readonly TimeDistributionItem[]
  readonly totalDurationMs: number
}): JSX.Element => (
  <section className="dshx:mt-4 dshx:rounded-md dshx:bg-muted/50 dshx:p-3">
    <h3 className="dshx:text-sm dshx:font-medium">{props.heading}</h3>
    {props.rows.length === 0 ? (
      <p className="dshx:mt-2 dshx:text-sm dshx:text-muted-foreground">{props.emptyLabel}</p>
    ) : (
      <ol className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2">
        {props.rows.map(row => {
          const share = props.totalDurationMs === 0 ? 0 : (row.totalDurationMs / props.totalDurationMs) * 100
          return (
            <li key={row.identifier} className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_auto] dshx:items-center dshx:gap-x-3 dshx:gap-y-1">
              <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{row.identifier}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">
                {formatDuration(row.totalDurationMs)} · {Math.round(share)}% · {row.calls} calls{row.detail === undefined ? '' : ` · ${row.detail}`}
              </span>
              <div
                className="dshx:col-span-2 dshx:h-1.5 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
                aria-label={`${row.identifier}: ${Math.round(share)}% of measured time`}
              >
                <div className="dshx:h-full dshx:rounded-full dshx:bg-primary" style={{ width: `${share}%` }} />
              </div>
            </li>
          )
        })}
      </ol>
    )}
  </section>
)

export const UsageActivityReport = (props: { readonly range: { readonly from: number; readonly to: number } }): JSX.Element => {
  const api = useApi(usageApi)
  const query = useQuery({
    queryKey: ['dshfiles-usage', 'activity', props.range.from, props.range.to],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.activity({ ...props.range, limit: 100 }, { signal: hostSignal }) }),
    retry: 1,
  })
  if (query.isPending) return <p className="dshx:text-sm dshx:text-muted-foreground">Loading activity…</p>
  if (query.isError) return <p className="dshx:text-sm dshx:text-destructive">{errorMessage(query.error, 'Could not load activity telemetry.')}</p>
  const report = query.data
  const commandDistribution = report.commandDistribution ?? []
  const testRunDistribution = report.testRunDistribution ?? []
  const commandDurationTotalMs = report.commandDurationTotalMs ?? 0
  const testRunDurationTotalMs = report.testRunDurationTotalMs ?? 0
  const callsForCategory = (category: ToolCategory): number => {
    if (report.categories.length > 0) return report.categories.find(row => row.category === category)?.calls ?? 0
    return report.tools.filter(row => row.category === category).reduce((total, row) => total + row.calls, 0)
  }
  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-5">
      <section className="dshx:rounded-md dshx:border dshx:border-border dshx:p-4">
        <h2 className="dshx:font-medium">Jev requests</h2>
        <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">
          {report.jev.calls.toLocaleString()} calls · {report.jev.successes.toLocaleString()} succeeded · {report.jev.failures.toLocaleString()} failed ·{' '}
          {Math.round((report.jev.successRate ?? 0) * 100)}% success · avg {formatDuration(report.jev.durationMs?.averageMs ?? report.jev.averageDurationMs)} ·
          p50 {formatDuration(report.jev.durationMs?.p50Ms ?? null)} · p90 {formatDuration(report.jev.durationMs?.p90Ms ?? null)} ·{' '}
          {report.jev.inputTokens.toLocaleString()} input / {report.jev.outputTokens.toLocaleString()} output tokens
        </p>
        {report.jev.bySource.length > 0 && (
          <ul className="dshx:mt-2 dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
            {report.jev.bySource.map(row => (
              <li key={row.source}>
                {row.source}: {row.calls} calls, {Math.round(row.successRate * 100)}% success, p90 {formatDuration(row.durationMs.p90Ms)}
              </li>
            ))}
          </ul>
        )}
        {report.jev.byOutcome.length > 0 && (
          <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">
            Outcomes: {report.jev.byOutcome.map(row => `${row.outcome} ${row.calls.toLocaleString()}`).join(' · ')}
          </p>
        )}
        <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">
          Read from the Jev request log the backlog and memory plugins record. Per-key totals and cost estimates are in the Jev usage card.
        </p>
      </section>
      <section className="dshx:rounded-md dshx:border dshx:border-border dshx:p-4">
        <h2 className="dshx:font-medium">Tool executions</h2>
        <dl className="dshx:mt-3 dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1 dshx:@max-pane-compact:grid-cols-3">
          {TOOL_CATEGORIES.map(category => (
            <div key={category} className="dshx:rounded-md dshx:bg-muted dshx:px-3 dshx:py-2">
              <dt className="dshx:text-xs dshx:text-muted-foreground">{TOOL_CATEGORY_LABELS[category]}</dt>
              <dd className="dshx:font-medium">{callsForCategory(category).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <TimeDistribution
          heading="Time by command"
          emptyLabel="No safely identifiable command timings in this range."
          rows={commandDistribution.map(row => ({ identifier: row.command, calls: row.calls, totalDurationMs: row.totalDurationMs }))}
          totalDurationMs={commandDurationTotalMs}
        />
        <TimeDistribution
          heading="Time by test runner"
          emptyLabel="No recognized test-run timings in this range."
          rows={testRunDistribution.map(row => ({
            identifier: row.runner,
            calls: row.calls,
            totalDurationMs: row.totalDurationMs,
            detail: `${row.successes} succeeded, ${row.errors} errors, ${row.interrupted} interrupted, ${row.unknown} unknown, ${row.pending} pending`,
          }))}
          totalDurationMs={testRunDurationTotalMs}
        />
        <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">
          Only bounded normalized executable/subcommand and runner identifiers are retained; raw arguments, outputs, paths, prompts and secrets are excluded.
          Compound or ambiguous commands are omitted. Runner outcomes reflect shell-call status, not parsed test output. Times are wall-clock and may overlap.
        </p>
        {report.categoryOutcomes.length > 0 && (
          <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">
            {report.categoryOutcomes
              .map(
                row =>
                  `${TOOL_CATEGORY_LABELS[row.category]}: ${row.successes} succeeded, ${row.errors} errors, ${row.interrupted} interrupted, ${row.unknown} unknown, ${row.pending} pending`,
              )
              .join(' · ')}
          </p>
        )}
        {report.tools.length === 0 ? (
          <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">No tool executions in this range.</p>
        ) : (
          <div className="dshx:mt-2 dshx:overflow-x-auto">
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
                    Interrupted
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Unknown
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Pending
                  </th>
                  <th scope="col" className="dshx:py-2 dshx:pr-3">
                    Avg / p50 / p90 / max
                  </th>
                  <th scope="col" className="dshx:py-2">
                    First / last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.tools.map(row => (
                  <tr key={`${row.category}:${row.owner ?? ''}:${row.name}`} className="dshx:border-b dshx:border-border/60">
                    <td className="dshx:py-2 dshx:pr-3">{TOOL_CATEGORY_LABELS[row.category]}</td>
                    <td className="dshx:py-2 dshx:pr-3 dshx:text-xs">{row.owner ?? '—'}</td>
                    <th scope="row" className="dshx:py-2 dshx:pr-3 dshx:font-mono dshx:text-xs">
                      {row.name}
                    </th>
                    <td className="dshx:py-2 dshx:pr-3">{row.calls.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">
                      {row.successes.toLocaleString()} ({Math.round((row.successRate ?? 0) * 100)}%)
                    </td>
                    <td className="dshx:py-2 dshx:pr-3">{row.errors.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">{row.interrupted.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">{row.unknown.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">{row.pending.toLocaleString()}</td>
                    <td className="dshx:py-2 dshx:pr-3">
                      {formatDuration(row.durationMs?.averageMs ?? row.averageDurationMs)} / {formatDuration(row.durationMs?.p50Ms ?? null)} /{' '}
                      {formatDuration(row.durationMs?.p90Ms ?? null)} / {formatDuration(row.durationMs?.maxMs ?? null)}
                    </td>
                    <td className="dshx:py-2 dshx:text-xs">
                      {row.timestamps?.firstStarted === null || row.timestamps?.firstStarted === undefined
                        ? '—'
                        : new Date(row.timestamps.firstStarted).toLocaleString()}{' '}
                      ·{' '}
                      {row.timestamps?.lastStarted === null || row.timestamps?.lastStarted === undefined
                        ? '—'
                        : new Date(row.timestamps.lastStarted).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">
          Counts are split by Skill, Plugin API, Plugin, MCP, DSH, and other sources. Arguments, outputs, commands, paths, and raw errors are never copied into
          this report.
        </p>
        {report.events.length > 0 && (
          <div className="dshx:mt-4">
            <h3 className="dshx:text-sm dshx:font-medium">Recent events</h3>
            <ol className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">
              {report.events.map((event, index) => (
                <li key={`${event.kind}:${event.at}:${index}`} className="dshx:flex dshx:flex-wrap dshx:gap-x-2 dshx:text-muted-foreground">
                  <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time>
                  <span className="dshx:text-foreground">
                    {event.kind === 'jev' ? `Jev (${event.source})` : `${event.name} (${TOOL_CATEGORY_LABELS[event.category]})`}
                  </span>
                  <span>{event.outcome}</span>
                  {event.durationMs !== null && <span>{formatDuration(event.durationMs)}</span>}
                  {event.kind === 'tool' && event.endedAt === null && <span>Still running</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  )
}
