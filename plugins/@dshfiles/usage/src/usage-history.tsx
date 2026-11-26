import { useState } from 'react'
import { UsageFormattingModel } from './format.js'
import type { ChartQuery, ChartView } from './api.js'

const TABLE_COLUMNS = ['requests', 'sessions', 'averageTokens', 'input', 'cacheRead', 'cacheWrite', 'output', 'cacheShare', 'costShare', 'cost'] as const

type TableColumn = (typeof TABLE_COLUMNS)[number]
type CalendarMetric = 'tokens' | 'cost' | 'requests'

const columnLabels = {
  requests: 'Requests',
  sessions: 'Threads',
  averageTokens: 'Avg tokens / req',
  input: 'Input',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  output: 'Output',
  cacheShare: 'Cache share',
  costShare: 'Cost share',
  cost: 'Cost',
} satisfies Record<TableColumn, string>

const numberValue = (value: number | null | undefined): string => (value == null ? '—' : UsageFormattingModel.formatCount(value))

const sortableValue = (row: ChartView['breakdown']['model'][number], column: TableColumn): number | null => {
  if (column === 'requests') return row.requests
  if (column === 'sessions') return row.sessions ?? null
  if (column === 'cost') return row.cost
  if (column === 'costShare') return row.cost
  if (column === 'averageTokens') return row.missingUsage === 0 && row.requests > 0 ? row.tokens / row.requests : null
  if (column === 'input') return row.missingUsage === 0 ? (row.input ?? null) : null
  if (column === 'cacheRead') return row.missingUsage === 0 ? (row.cacheRead ?? null) : null
  if (column === 'cacheWrite') return row.missingUsage === 0 ? (row.cacheWrite ?? null) : null
  if (column === 'output') return row.missingUsage === 0 ? (row.output ?? null) : null
  const prompt = (row.input ?? 0) + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0)
  return row.missingUsage === 0 && prompt > 0 ? (row.cacheRead ?? 0) / prompt : null
}

const cellValue = (row: ChartView['breakdown']['model'][number], column: TableColumn, totalCost: number | null): string => {
  if (column === 'requests') return numberValue(row.requests)
  if (column === 'sessions') return numberValue(row.sessions)
  if (column === 'averageTokens') {
    const average = sortableValue(row, column)
    return average === null ? '—' : numberValue(average)
  }
  if (column === 'input') return row.missingUsage === 0 ? numberValue(row.input) : '—'
  if (column === 'cacheRead') return row.missingUsage === 0 ? numberValue(row.cacheRead) : '—'
  if (column === 'cacheWrite') return row.missingUsage === 0 ? numberValue(row.cacheWrite) : '—'
  if (column === 'output') return row.missingUsage === 0 ? numberValue(row.output) : '—'
  if (column === 'cacheShare') {
    const share = sortableValue(row, column)
    return share === null ? '—' : UsageFormattingModel.formatPercent(share)
  }
  if (column === 'costShare') {
    const share = totalCost === null || totalCost <= 0 || row.missingUsage !== 0 || row.unpriced !== 0 ? null : row.cost / totalCost
    return share === null ? '—' : UsageFormattingModel.formatPercent(share)
  }
  return row.unpriced === 0 && row.missingUsage === 0 ? UsageFormattingModel.formatCost(row.cost) : `${UsageFormattingModel.formatCost(row.cost)}*`
}

export const UsageBreakdownTable = (props: {
  readonly view: ChartView
  readonly groupBy: ChartQuery['groupBy']
  readonly onShowRequests: (search: string, groupBy: ChartQuery['groupBy']) => void
}): JSX.Element => {
  const [sort, setSort] = useState<{ column: TableColumn | 'group'; direction: 'asc' | 'desc' }>({ column: 'cost', direction: 'desc' })
  const rows = props.view.breakdown[props.groupBy] ?? []
  const totalCost = props.view.summary.missingUsage === 0 && props.view.summary.unpriced === 0 ? props.view.summary.cost : null
  const sorted = [...rows].sort((left, right) => {
    const a = sort.column === 'group' ? left.key.toLocaleLowerCase() : sortableValue(left, sort.column)
    const b = sort.column === 'group' ? right.key.toLocaleLowerCase() : sortableValue(right, sort.column)
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
    const comparison = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b)
    return sort.direction === 'asc' ? comparison : -comparison
  })
  const toggleSort = (column: TableColumn | 'group'): void => {
    setSort(current => ({ column, direction: current.column === column && current.direction === 'desc' ? 'asc' : 'desc' }))
  }
  /**
   * A bare sort control on the cell's own inset, so each label sits on its column's value edge, with a fixed arrow seat
   * (on the outer side: after the left-aligned first label, before the right-aligned numeric ones) so sorting never
   * moves a label (council round 12, D1).
   */
  const heading = (column: TableColumn | 'group', label: string): JSX.Element => {
    const active = sort.column === column
    const arrow = (
      <span aria-hidden data-sort-slot="" className="dshx:inline-block dshx:w-3 dshx:shrink-0 dshx:text-center">
        {active ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
      </span>
    )
    return (
      <th
        key={column}
        scope="col"
        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
        className="dshx:whitespace-nowrap dshx:px-2 dshx:py-2 dshx:text-right dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:first:text-left"
      >
        <button
          type="button"
          onClick={() => toggleSort(column)}
          aria-label={`Sort by ${label}`}
          className="dshx:inline-flex dshx:min-h-6 dshx:items-center dshx:gap-0.5 dshx:rounded-sm dshx:hover:text-foreground"
        >
          {column === 'group' ? (
            <>
              {label}
              {arrow}
            </>
          ) : (
            <>
              {arrow}
              {label}
            </>
          )}
        </button>
      </th>
    )
  }
  return (
    // The hairline card the totals, trend and "Where it went" above take, so the page keeps one rhythm; the cells' own
    // 8 px inset is pulled back so the first column starts on the title's edge (council round 13, D1).
    <section className="dshx:min-w-0 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-4 dshx:pt-3.5 dshx:pb-2 dshx:@max-pane-narrow:px-3">
      <h3 className="dshx:mb-1 dshx:text-sm dshx:font-semibold">Usage distribution</h3>
      <div className="dshx:-mx-2 dshx:overflow-x-auto">
        <table className="dshx:w-full dshx:text-sm">
          <thead className="dshx:border-b dshx:border-border">
            <tr>
              {heading('group', props.groupBy === 'provider' ? 'Provider / account' : props.groupBy[0]?.toUpperCase() + props.groupBy.slice(1))}
              {TABLE_COLUMNS.map(column => heading(column, columnLabels[column]))}
            </tr>
          </thead>
          <tbody className="dshx:divide-y dshx:divide-border/50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length + 1} className="dshx:p-5 dshx:text-center dshx:text-muted-foreground">
                  No usage recorded.
                </td>
              </tr>
            ) : (
              sorted.map(row => {
                // The group cell is the name alone: the Cost share column already states the share (council round 12, D1).
                return (
                  <tr key={row.key}>
                    <td className="dshx:min-w-40 dshx:max-w-64 dshx:px-2 dshx:py-2">
                      <button
                        type="button"
                        onClick={() => props.onShowRequests(row.key, props.groupBy)}
                        className="dshx:block dshx:w-full dshx:truncate dshx:rounded-sm dshx:text-left dshx:hover:underline"
                      >
                        {row.key}
                      </button>
                    </td>
                    {TABLE_COLUMNS.map(column => (
                      <td key={column} className="dshx:whitespace-nowrap dshx:px-2 dshx:py-2 dshx:text-right dshx:tabular-nums">
                        {cellValue(row, column, totalCost)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {(props.view.summary.missingUsage ?? 0) > 0 || props.view.summary.unpriced > 0 ? (
        <p className="dshx:mt-2 dshx:text-2xs dshx:text-muted-foreground">
          *Totals are incomplete; cost shares use priced known totals. Token averages and shares require complete usage.
        </p>
      ) : null}
    </section>
  )
}

const calendarClasses = ['dshx:bg-muted', 'dshx:bg-data-1/25', 'dshx:bg-data-1/45', 'dshx:bg-data-1/70', 'dshx:bg-data-1'] as const

const calendarMetricLabels = { tokens: 'Tokens', cost: 'Estimated cost', requests: 'Requests' } satisfies Record<CalendarMetric, string>

/** The daily heatmap of the measure the chart above shows: the page keeps one metric switch (council round 2, D1). */
export const UsageCalendar = (props: {
  readonly view: ChartView
  readonly metric: CalendarMetric
  readonly range: { readonly from: number; readonly to: number }
}): JSX.Element => {
  const metric = props.metric
  const grouped = new Map<number, { tokens: number; requests: number; cost: number; missingUsage: number | null; unpriced: number | null }>()
  for (const bucket of props.view.buckets) {
    const day = grouped.get(bucket.start) ?? { tokens: 0, requests: 0, cost: 0, missingUsage: 0, unpriced: 0 }
    day.tokens += bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output
    day.requests += bucket.requests
    day.cost += bucket.cost
    day.missingUsage = day.missingUsage === null || bucket.missingUsage === undefined ? null : day.missingUsage + bucket.missingUsage
    day.unpriced = day.unpriced === null || bucket.unpriced === undefined ? null : day.unpriced + bucket.unpriced
    grouped.set(bucket.start, day)
  }
  const calendarFrom = Math.max(props.range.from, props.range.to - 365 * 86_400_000)
  const days: { start: number; values: { tokens: number; requests: number; cost: number; missingUsage: number | null; unpriced: number | null } }[] = []
  const date = new Date(calendarFrom)
  while (date.getTime() < props.range.to && days.length < 366) {
    const start = date.getTime()
    days.push({ start, values: grouped.get(start) ?? { tokens: 0, requests: 0, cost: 0, missingUsage: 0, unpriced: 0 } })
    date.setDate(date.getDate() + 1)
  }
  const complete = (day: (typeof days)[number]): number | null => {
    if (metric === 'requests') return day.values.requests
    if (metric === 'tokens') return day.values.missingUsage === 0 ? day.values.tokens : null
    return day.values.missingUsage === 0 && day.values.unpriced === 0 ? day.values.cost : null
  }
  const values = days.map(complete).filter((value): value is number => value !== null)
  const maximum = Math.max(...values, 0)
  const threshold = (value: number | null): number => (value === null || value === 0 || maximum === 0 ? 0 : Math.min(4, Math.ceil((value / maximum) * 4)))
  const startOffset = new Date(calendarFrom).getDay()
  const suffix = metric === 'cost' ? 'estimated USD' : metric === 'tokens' ? 'tokens' : 'requests'
  return (
    <section className="dshx:border-t dshx:border-border dshx:pt-4">
      <header className="dshx:mb-2 dshx:flex dshx:flex-wrap dshx:items-baseline dshx:gap-2">
        <h3 className="dshx:text-sm dshx:font-semibold">Daily calendar</h3>
        <span className="dshx:text-xs dshx:text-muted-foreground">{calendarMetricLabels[metric]}</span>
      </header>
      <div className="dshx:overflow-x-auto">
        <div role="img" aria-label={`Daily ${suffix} over ${days.length} days`} className="dshx:grid dshx:w-max dshx:grid-flow-col dshx:grid-rows-7 dshx:gap-1">
          {Array.from({ length: startOffset }, (_, index) => (
            <span key={`spacer-${String(index)}`} aria-hidden="true" />
          ))}
          {days.map(day => {
            const value = complete(day)
            const localDate = new Date(day.start)
            const label = `${localDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}: ${value === null ? 'incomplete' : metric === 'cost' ? UsageFormattingModel.formatCost(value) : UsageFormattingModel.formatCount(value)} ${suffix}`
            return <span key={day.start} aria-label={label} className={`dshx:size-3 dshx:rounded-sm ${calendarClasses[threshold(value)]}`} />
          })}
        </div>
      </div>
      <div className="dshx:mt-2 dshx:flex dshx:justify-between dshx:text-2xs dshx:text-muted-foreground">
        <span>{days[0] === undefined ? '' : new Date(days[0].start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        <span>
          {days[days.length - 1] === undefined
            ? ''
            : new Date(days[days.length - 1]?.start ?? 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </section>
  )
}
