import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Chart, ChartFrame, barY, defineChart, lineY, scaleBand, scaleLinear, stack, tooltip } from '@dshfiles/plugin-ui/chart'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { CalendarIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { usageApi, type ChartQuery, type ChartView, type RequestPage } from './api.js'
import { useMemo, useState, type ReactNode } from 'react'
import type { AccountUsageViewProps } from '@dshfiles/ai-accounts/account-usage-view'
import { AccountUsageDashboardModel, type AccountUsageDay, type UsagePeriod } from './account-usage-dashboard-model.js'

const Panel = (props: { heading: string; children: ReactNode; action?: ReactNode; className?: string }): JSX.Element => (
  <section className={cn('dshx:min-w-0 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3', props.className)}>
    <header className="dshx:mb-2 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
      <h3 className="dshx:text-sm dshx:font-semibold">{props.heading}</h3>
      {props.action}
    </header>
    {props.children}
  </section>
)

const Comparison = (props: { current: number | null | undefined; previous: number | null | undefined; days: UsagePeriod; latency?: boolean }): JSX.Element => {
  const change = AccountUsageDashboardModel.percentChange(props.current, props.previous)
  const favorable = change !== null && (props.latency === true ? change <= 0 : change >= 0)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-[11px]">
      <span className={cn('dshx:font-medium', change === null ? 'dshx:text-muted-foreground' : favorable ? 'dshx:text-success' : 'dshx:text-warning')}>
        {change === null ? '— No comparison available' : `${change > 0 ? '↑' : change < 0 ? '↓' : '↔'} ${Math.abs(change).toFixed(0)}%`}
      </span>
      <span className="dshx:text-muted-foreground">vs previous {props.days} days</span>
    </div>
  )
}

const Metric = (props: { label: string; value: string; children: ReactNode }): JSX.Element => (
  <div className="dshx:min-w-0 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3">
    <p className="dshx:mb-1.5 dshx:text-xs dshx:text-muted-foreground">{props.label}</p>
    <p className="dshx:mb-1 dshx:text-2xl dshx:font-semibold dshx:tracking-tight dshx:tabular-nums">{props.value}</p>
    {props.children}
  </div>
)

const Legend = (): JSX.Element => (
  <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-4 dshx:gap-y-1 dshx:text-[10px] dshx:text-muted-foreground" aria-label="Chart legend">
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <span className="dshx:h-0.5 dshx:w-3 dshx:bg-chart-1" />
      Requests
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <span className="dshx:size-2 dshx:rounded-sm dshx:bg-chart-1 dshx:opacity-40" />
      Input tokens
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <span className="dshx:size-2 dshx:rounded-sm dshx:bg-chart-1 dshx:opacity-60" />
      Output tokens
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <span className="dshx:w-3 dshx:border-t dshx:border-dashed dshx:border-muted-foreground" />
      Cost (USD)
    </span>
  </div>
)

const UsageTimeline = (props: { days: readonly AccountUsageDay[]; empty: boolean }): JSX.Element => {
  const definition = useMemo(() => {
    const tokens = props.days.flatMap(day =>
      day.input === null || day.output === null
        ? []
        : [
            { label: day.label, kind: 'Input tokens', metric: 'tokens', value: day.input },
            { label: day.label, kind: 'Output tokens', metric: 'tokens', value: day.output },
          ],
    )
    const requests = props.days.map(day => ({ label: day.label, metric: 'requests', value: day.requests }))
    // Retain null points, so unavailable cost days remain line gaps.
    const costs = props.days.map(day => ({ label: day.label, metric: 'cost', value: day.cost }))
    const labels = props.days.map(day => day.label)
    const step = Math.max(1, Math.ceil(labels.length / 7))
    const visibleLabels = new Set(labels.filter((_, index) => index % step === 0))
    return defineChart({
      marks: [
        barY(tokens, { x: 'label', y: 'value', color: 'kind', yScale: 'tokens', layout: stack(), maxThickness: 50 }),
        lineY(requests, { x: 'label', y: 'value', yScale: 'requests', stroke: 'var(--ts-chart-1)', strokeWidth: 2, points: true }),
        lineY(costs, { x: 'label', y: 'value', yScale: 'cost', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.5, strokeDasharray: '3 4' }),
      ],
      scales: {
        y: null,
        x: { scale: () => scaleBand<string>().domain(labels).padding(0.4), axis: { ticks: { format: value => (visibleLabels.has(value) ? value : '') } } },
        tokens: {
          channel: 'y',
          side: 'left',
          scale: scaleLinear,
          grid: true,
          axis: { label: 'Tokens', ticks: { count: 4, format: value => AccountUsageDashboardModel.usageCount(Number(value)) } },
        },
        requests: {
          channel: 'y',
          side: 'right',
          scale: scaleLinear,
          axis: { label: 'Requests', ticks: { count: 4, format: value => AccountUsageDashboardModel.usageCount(Number(value)) } },
        },
        cost: {
          channel: 'y',
          side: 'right',
          scale: scaleLinear,
          axis: { label: 'Cost (USD)', ticks: { count: 4, format: value => AccountUsageDashboardModel.usageCost(Number(value)) } },
        },
      },
      color: {
        domain: ['Input tokens', 'Output tokens'],
        range: ['color-mix(in srgb, var(--ts-chart-1) 40%, transparent)', 'color-mix(in srgb, var(--ts-chart-1) 60%, transparent)'],
      },
      tooltip: {
        use: tooltip,
        format: point =>
          `${point.datum.label}: ${point.datum.metric === 'cost' ? AccountUsageDashboardModel.usageCost(point.datum.value) : AccountUsageDashboardModel.usageCount(point.datum.value)}${point.datum.metric === 'tokens' ? ' tokens' : point.datum.metric === 'requests' ? ' requests' : ''}`,
      },
    })
  }, [props.days])
  return (
    <Panel heading="Usage over time" action={<Legend />}>
      <ChartFrame>
        {props.empty ? (
          <p className="dshx:flex dshx:h-48 dshx:items-center dshx:justify-center dshx:text-xs">No requests recorded in this period.</p>
        ) : (
          <div className="dshx:overflow-x-auto">
            <div className="dshx:min-w-[480px]">
              <Chart
                ariaLabel="Account usage over time"
                ariaDescription="Input and output tokens stacked by day. Requests and estimated USD cost use their own labelled axes. Missing measurements are omitted, not treated as zero."
                definition={definition}
                height={210}
              />
            </div>
          </div>
        )}
      </ChartFrame>
    </Panel>
  )
}

const cellClass = 'dshx:whitespace-nowrap dshx:px-2 dshx:py-1.5 dshx:text-right dshx:tabular-nums'
const headingClass = 'dshx:whitespace-nowrap dshx:px-2 dshx:py-1.5 dshx:text-right dshx:font-normal dshx:text-muted-foreground'
const EmptyRow = (props: { columns: number; label: string }): JSX.Element => (
  <tr>
    <td colSpan={props.columns} className="dshx:p-5 dshx:text-center dshx:text-muted-foreground">
      {props.label}
    </td>
  </tr>
)

const ModelTable = (props: { view: ChartView }): JSX.Element => {
  const totalCost = AccountUsageDashboardModel.completeCost(props.view.summary)
  return (
    <Panel heading="Usage by model">
      <div className="dshx:overflow-x-auto">
        <table className="dshx:w-full dshx:text-xs">
          <thead className="dshx:border-b dshx:border-border dshx:bg-muted/30">
            <tr>
              <th className="dshx:px-2 dshx:py-1.5 dshx:text-left dshx:font-normal dshx:text-muted-foreground">Model</th>
              <th className={headingClass}>Requests</th>
              <th className={headingClass}>Tokens</th>
              <th className={headingClass}>Cost (USD)</th>
              <th className={headingClass}>% cost</th>
            </tr>
          </thead>
          <tbody className="dshx:divide-y dshx:divide-border/50">
            {props.view.breakdown.model.length === 0 ? (
              <EmptyRow columns={5} label="No model usage recorded." />
            ) : (
              props.view.breakdown.model.map(row => {
                const cost = AccountUsageDashboardModel.completeCost(row)
                const share = totalCost !== null && totalCost > 0 && cost !== null ? (cost / totalCost) * 100 : null
                return (
                  <tr key={row.key}>
                    <td className="dshx:max-w-48 dshx:truncate dshx:px-2 dshx:py-1.5">{row.key || 'Unknown model'}</td>
                    <td className={cellClass}>{AccountUsageDashboardModel.usageCount(row.requests)}</td>
                    <td className={cellClass}>{AccountUsageDashboardModel.usageCount(row.requests === 0 || row.missingUsage === 0 ? row.tokens : null)}</td>
                    <td className={cellClass}>{AccountUsageDashboardModel.usageCost(cost)}</td>
                    <td className={cellClass}>
                      <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-2">
                        <span>{share === null ? '—' : `${share.toFixed(0)}%`}</span>
                        <span className="dshx:h-1.5 dshx:w-16 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
                          <span className="dshx:block dshx:h-full dshx:rounded-full dshx:bg-info" style={{ width: `${share ?? 0}%` }} />
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

const DayTable = (props: { days: readonly AccountUsageDay[]; empty: boolean }): JSX.Element => (
  <Panel heading="Usage by day">
    <div className="dshx:max-h-64 dshx:overflow-auto">
      <table className="dshx:w-full dshx:text-xs">
        <thead className="dshx:sticky dshx:top-0 dshx:border-b dshx:border-border dshx:bg-card">
          <tr>
            <th className="dshx:px-2 dshx:py-1.5 dshx:text-left dshx:font-normal dshx:text-muted-foreground">Date</th>
            <th className={headingClass}>Requests</th>
            <th className={headingClass}>Tokens</th>
            <th className={headingClass}>Cost (USD)</th>
          </tr>
        </thead>
        <tbody className="dshx:divide-y dshx:divide-border/50">
          {props.empty ? (
            <EmptyRow columns={4} label="No daily usage recorded." />
          ) : (
            [...props.days].reverse().map(row => (
              <tr key={row.start}>
                <td className="dshx:whitespace-nowrap dshx:px-2 dshx:py-1.5">{row.label}</td>
                <td className={cellClass}>{AccountUsageDashboardModel.usageCount(row.requests)}</td>
                <td className={cellClass}>{AccountUsageDashboardModel.usageCount(row.tokens)}</td>
                <td className={cellClass}>{AccountUsageDashboardModel.usageCost(row.cost)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </Panel>
)

const RecentRequests = (props: { requests: RequestPage; onViewAll: () => void }): JSX.Element => (
  <Panel
    heading="Recent requests"
    action={
      <Button size="sm" variant="outline" onClick={props.onViewAll}>
        View all
        <ChevronRightIcon className="dshx:size-3" />
      </Button>
    }
  >
    <div className="dshx:overflow-x-auto">
      <table className="dshx:w-full dshx:text-xs">
        <thead className="dshx:border-b dshx:border-border dshx:bg-muted/30">
          <tr>
            <th className="dshx:px-2 dshx:py-1.5 dshx:text-left dshx:font-normal dshx:text-muted-foreground">Time</th>
            <th className="dshx:px-2 dshx:py-1.5 dshx:text-left dshx:font-normal dshx:text-muted-foreground">Model</th>
            <th className={headingClass}>Input tokens</th>
            <th className={headingClass}>Output tokens</th>
            <th className={headingClass}>Cost (USD)</th>
            <th className={headingClass}>Status</th>
          </tr>
        </thead>
        <tbody className="dshx:divide-y dshx:divide-border/50">
          {props.requests.rows.length === 0 ? (
            <EmptyRow columns={6} label="No requests recorded in this period." />
          ) : (
            props.requests.rows.map(row => (
              <tr key={row.id}>
                <td className="dshx:whitespace-nowrap dshx:px-2 dshx:py-1.5">
                  <time dateTime={new Date(row.startedAt).toISOString()}>
                    {AccountUsageDashboardModel.usageDate(row.startedAt)}{' '}
                    {new Date(row.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </td>
                <td className="dshx:max-w-48 dshx:truncate dshx:px-2 dshx:py-1.5">{row.model || 'Unknown model'}</td>
                <td className={cellClass}>
                  {AccountUsageDashboardModel.usageCount(
                    row.input === null || row.cacheRead === null || row.cacheWrite === null ? null : row.input + row.cacheRead + row.cacheWrite,
                  )}
                </td>
                <td className={cellClass}>{AccountUsageDashboardModel.usageCount(row.output)}</td>
                <td className={cellClass}>{AccountUsageDashboardModel.usageCost(row.cost)}</td>
                <td className={cellClass}>
                  <span className="dshx:inline-flex dshx:items-center dshx:gap-1.5">
                    <span
                      className={cn(
                        'dshx:size-1.5 dshx:rounded-full',
                        row.status === 'ok' ? 'dshx:bg-success' : row.status === 'failed' ? 'dshx:bg-destructive' : 'dshx:bg-muted-foreground',
                      )}
                    />
                    {row.status === 'ok' ? 'Success' : row.status === 'failed' ? 'Failed' : 'Aborted'}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </Panel>
)

/** Pure view also used by isolated screenshot fixtures; production data comes only from the Usage API. */
export const AccountUsageDashboardContent = (props: {
  query: ChartQuery
  days: UsagePeriod
  view: ChartView
  requests: RequestPage
  onOpenUsageHistory: () => void
}): JSX.Element => {
  const summary = props.view.summary
  const tokens = AccountUsageDashboardModel.totalTokens(summary)
  const cost = AccountUsageDashboardModel.completeCost(summary)
  const previousTokens = summary.previous.requests === 0 || summary.previous.missingUsage === 0 ? summary.previous.tokens : null
  const days = AccountUsageDashboardModel.accountUsageDays(props.query, props.view)
  return (
    <>
      <div className="dshx:grid dshx:grid-cols-4 dshx:gap-3 dshx:@max-pane-compact:grid-cols-2">
        <Metric label="Total requests" value={AccountUsageDashboardModel.usageCount(summary.requests)}>
          <Comparison current={summary.requests} previous={summary.previous.requests} days={props.days} />
        </Metric>
        <Metric label="Total tokens" value={AccountUsageDashboardModel.usageCount(tokens)}>
          <Comparison current={tokens} previous={previousTokens} days={props.days} />
        </Metric>
        <Metric label="Estimated cost" value={AccountUsageDashboardModel.usageCost(cost)}>
          <Comparison current={cost} previous={AccountUsageDashboardModel.completeCost(summary.previous)} days={props.days} />
        </Metric>
        <Metric label="Average latency" value={AccountUsageDashboardModel.usageDuration(summary.averageDurationMs)}>
          <Comparison current={summary.averageDurationMs} previous={summary.previous.averageDurationMs} days={props.days} latency />
        </Metric>
      </div>
      <UsageTimeline days={days} empty={summary.requests === 0} />
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
        <ModelTable view={props.view} />
        <DayTable days={days} empty={summary.requests === 0} />
      </div>
      <RecentRequests requests={props.requests} onViewAll={props.onOpenUsageHistory} />
      <p className="dshx:text-[11px] dshx:leading-relaxed dshx:text-muted-foreground">
        DSH-recorded requests only. Cost is a list-price estimate, not your subscription bill. Input includes cache reads and writes. Average latency is the
        mean completed request duration. — means unavailable
        {summary.missingUsage ? `; ${summary.missingUsage.toLocaleString()} requests have no token counts` : ''}
        {summary.unpriced ? `; ${summary.unpriced.toLocaleString()} requests have no catalog price` : ''}.
      </p>
    </>
  )
}

export const AccountUsageDashboard = (props: AccountUsageViewProps): JSX.Element => {
  const api = useApi(usageApi)
  const [period, setPeriod] = useState<UsagePeriod>(7)
  const query = useMemo(() => AccountUsageDashboardModel.accountUsageQuery(props.accountId, period, Date.now()), [props.accountId, period])
  const usage = useQuery({
    queryKey: ['ai-accounts', 'account-usage-dashboard', props.accountId, period, query],
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        request: async hostSignal => {
          const [view, requests] = await Promise.all([
            api.charts(query, { signal: hostSignal }),
            api.requests({ from: query.from, to: query.to, provider: props.accountId, sort: 'startedAt', direction: 'desc', limit: 5 }, { signal: hostSignal }),
          ])
          AccountUsageDashboardModel.requireAccountUsageScope(props.accountId, view, requests)
          return { view, requests }
        },
      }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return (
    <section
      aria-label={`Usage for ${props.displayName}`}
      className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:text-foreground"
    >
      <div className="dshx:flex dshx:justify-end">
        <Combobox
          label="Usage period"
          value={String(period)}
          options={AccountUsageDashboardModel.USAGE_PERIODS.map(days => ({ value: String(days), label: `Last ${days} days` }))}
          onValueChange={value => {
            const next = AccountUsageDashboardModel.USAGE_PERIODS.find(days => String(days) === value)
            if (next !== undefined) setPeriod(next)
          }}
          trigger={
            <span className="dshx:flex dshx:items-center dshx:gap-2">
              <CalendarIcon className="dshx:size-3.5" />
              Last {period} days
            </span>
          }
          triggerClassName="dshx:w-40 dshx:text-xs"
        />
      </div>
      {usage.isError ? (
        <div role="status" className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-5 dshx:text-sm">
          <p>Account usage unavailable.</p>
          <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">
            {isApiOwnerMissing(usage.error)
              ? 'The Usage plugin is not active on this Host. Enable it to view recorded account usage.'
              : errorMessage(usage.error, 'Could not load recorded account usage.')}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="dshx:mt-3"
            onClick={() => {
              void usage.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : usage.data === undefined ? (
        <p role="status" className="dshx:p-6 dshx:text-sm dshx:text-muted-foreground">
          Loading account usage…
        </p>
      ) : (
        <AccountUsageDashboardContent
          query={query}
          days={period}
          view={usage.data.view}
          requests={usage.data.requests}
          onOpenUsageHistory={props.onOpenUsageHistory}
        />
      )}
    </section>
  )
}
