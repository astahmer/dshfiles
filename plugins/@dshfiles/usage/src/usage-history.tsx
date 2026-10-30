import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useState } from 'react'
import { UsageFormattingModel } from './format.js'
import type { ChartQuery, ChartView } from './api.js'

const TABLE_COLUMNS = ['requests', 'sessions', 'averageTokens', 'input', 'cacheRead', 'cacheWrite', 'output', 'cacheShare', 'costShare', 'cost'] as const

type TableColumn = (typeof TABLE_COLUMNS)[number]
type CalendarMetric = 'tokens' | 'cost' | 'requests'

const columnLabels = {
  requests: 'Requests',
  sessions: 'Sessions',
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
  const totals = rows.reduce((sum, row) => sum + row.cost, 0)
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
  const heading = (column: TableColumn | 'group', label: string): JSX.Element => (
    <th key={column} className="dshx:whitespace-nowrap dshx:px-2 dshx:py-2 dshx:text-right dshx:font-medium dshx:text-muted-foreground first:dshx:text-left">
      <Button size="xs" variant="ghost" onClick={() => toggleSort(column)} aria-label={`Sort by ${label}`}>
        {label}
        {sort.column === column ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
      </Button>
    </th>
  )
  return (
    <section className="dshx:min-w-0 dshx:rounded-lg dshx:border dshx:p-3">
      <h3 className="dshx:mb-2 dshx:text-sm dshx:font-semibold">Usage distribution</h3>
      <div className="dshx:overflow-x-auto">
        <table className="dshx:w-full dshx:text-xs">
          <thead className="dshx:border-b dshx:bg-muted/30">
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
                const share = totalCost === null || totalCost <= 0 ? null : row.cost / totalCost
                const knownCostShare = totals > 0 ? row.cost / totals : null
                return (
                  <tr key={row.key}>
                    <td className="dshx:min-w-40 dshx:max-w-64 dshx:px-2 dshx:py-2">
                      <button
                        type="button"
                        onClick={() => props.onShowRequests(row.key, props.groupBy)}
                        className="dshx:w-full dshx:text-left dshx:hover:underline"
                      >
                        <span className="dshx:block dshx:truncate">{row.key}</span>
                        <span className="dshx:mt-1 dshx:flex dshx:items-center dshx:gap-2 dshx:text-[10px] dshx:text-muted-foreground">
                          <span className="dshx:h-1.5 dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
                            <span
                              className="dshx:block dshx:h-full dshx:rounded-full dshx:bg-chart-1"
                              style={{ width: `${Math.min(100, (knownCostShare ?? 0) * 100)}%` }}
                            />
                          </span>
                          {share === null ? 'priced share*' : UsageFormattingModel.formatPercent(share)}
                        </span>
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
        <p className="dshx:mt-2 dshx:text-[11px] dshx:text-muted-foreground">
          *Totals are incomplete; cost shares use priced known totals. Token averages and shares require complete usage.
        </p>
      ) : null}
    </section>
  )
}

const calendarClasses = ['dshx:bg-muted', 'dshx:bg-chart-1/25', 'dshx:bg-chart-1/45', 'dshx:bg-chart-1/70', 'dshx:bg-chart-1'] as const

export const UsageCalendar = (props: { readonly view: ChartView; readonly range: { readonly from: number; readonly to: number } }): JSX.Element => {
  const [metric, setMetric] = useState<CalendarMetric>('tokens')
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
    <section className="dshx:rounded-lg dshx:border dshx:p-3">
      <header className="dshx:mb-2 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <h3 className="dshx:text-sm dshx:font-semibold">Daily calendar</h3>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Calendar metric"
          value={metric}
          onValueChange={value => {
            if (value === 'tokens' || value === 'cost' || value === 'requests') setMetric(value)
          }}
        >
          <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
          <ToggleGroupItem value="cost">Cost</ToggleGroupItem>
          <ToggleGroupItem value="requests">Requests</ToggleGroupItem>
        </ToggleGroup>
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
      <div className="dshx:mt-2 dshx:flex dshx:justify-between dshx:text-[10px] dshx:text-muted-foreground">
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
