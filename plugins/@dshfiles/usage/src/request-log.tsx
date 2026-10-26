import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { usageApi, type RequestQuery, type RequestView } from './api.js'
import type { RequestPurpose, RequestStatus } from './fold.js'
import { UsageFormattingModel, type OpenThread } from './format.js'

const PAGE_SIZE = 200

const STATUS_CHIPS: readonly { readonly value: RequestStatus | 'all'; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'failed', label: 'Failed' },
]

const STATUS_LABEL: Readonly<Record<RequestStatus, string>> = { ok: 'OK', aborted: 'Aborted', failed: 'Failed' }
const STATUS_DOT: Readonly<Record<RequestStatus, string>> = {
  ok: 'dshx:bg-success',
  aborted: 'dshx:bg-warning',
  failed: 'dshx:bg-destructive',
}

type SortColumn = RequestQuery['sort']

const SortableHead = (props: {
  readonly column: SortColumn
  readonly label: string
  readonly sort: { readonly column: SortColumn; readonly direction: 'asc' | 'desc' }
  readonly onSort: (column: SortColumn) => void
  readonly className?: string
}): JSX.Element => {
  const active = props.sort.column === props.column
  return (
    <TableHead className={cn('dshx:text-right', props.className)} aria-sort={active ? (props.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:uppercase dshx:hover:text-foreground"
        onClick={() => props.onSort(props.column)}
      >
        {props.label}
        {active ? props.sort.direction === 'asc' ? <ArrowUpIcon className="dshx:size-3" /> : <ArrowDownIcon className="dshx:size-3" /> : null}
      </button>
    </TableHead>
  )
}

const threadLabel = (row: RequestView): string => {
  const where = row.turn === null ? (row.purpose === 'title' ? 'title generation' : row.purpose) : `turn ${String(row.turn)}, step ${String(row.step ?? 0)}`
  return `${row.sessionTitle ?? row.sessionId} · ${where}`
}

export const RequestLog = (props: {
  readonly range: { readonly from: number; readonly to: number }
  readonly purposes: readonly RequestPurpose[] | undefined
  readonly sessionId?: string
  readonly search: string
  readonly onSearch: (search: string) => void
  readonly openThread: OpenThread
}): JSX.Element => {
  const api = useApi(usageApi)
  const [status, setStatus] = useState<RequestStatus | 'all'>('all')
  const [sort, setSort] = useState<{ readonly column: SortColumn; readonly direction: 'asc' | 'desc' }>({ column: 'startedAt', direction: 'desc' })
  const [notice, setNotice] = useState<string | null>(null)
  const search = useDebouncedValue({ value: props.search.trim(), delayMs: 200 })
  const query: RequestQuery = {
    from: props.range.from,
    to: props.range.to,
    sort: sort.column,
    direction: sort.direction,
    limit: PAGE_SIZE,
  }
  if (props.purposes !== undefined) query.purposes = [...props.purposes]
  if (props.sessionId !== undefined) query.sessionId = props.sessionId
  if (search.length > 0) query.search = search
  if (status !== 'all') query.status = status
  const page = useQuery({
    queryKey: ['dshfiles-usage', 'requests', query],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.requests(query, { signal: hostSignal }) }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    retry: 1,
  })
  const [openedAt] = useState(() => Date.now())
  const now = page.dataUpdatedAt || openedAt
  const onSort = (column: SortColumn): void =>
    setSort(current => (current.column === column ? { column, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { column, direction: 'desc' }))
  const open = (row: RequestView): void => {
    const outcome = props.openThread({ sessionId: row.sessionId, parentSessionId: row.parentSessionId })
    setNotice(
      outcome === 'missing'
        ? `${row.sessionTitle ?? row.sessionId} is no longer in the thread list (archived or deleted).`
        : outcome === 'parent'
          ? 'Opened the parent thread: this subagent has no thread of its own.'
          : null,
    )
  }
  const data = page.data
  const shown = data?.rows.length ?? 0
  const matching = data === undefined ? 0 : status === 'all' ? data.total : (data.statusCounts[status] ?? 0)

  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:p-3" aria-labelledby="dshfiles-usage-log-title">
      <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
          <h2 id="dshfiles-usage-log-title" className="dshx:text-base dshx:font-semibold">
            Request log
          </h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {data === undefined ? 'Loading…' : `${shown.toLocaleString()} of the latest ${matching.toLocaleString()} requests`}
          </p>
        </div>
        <label className="dshx:relative dshx:w-full dshx:sm:w-72">
          <span className="dshx:sr-only">Search requests</span>
          <SearchIcon className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-2 dshx:size-3.5 dshx:-translate-y-1/2 dshx:text-muted-foreground" />
          <Input value={props.search} onChange={event => props.onSearch(event.target.value)} placeholder="Model, provider or project" className="dshx:pl-7" />
        </label>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5" role="group" aria-label="Status">
        {STATUS_CHIPS.map(chip => (
          <Button
            key={chip.value}
            size="xs"
            variant={status === chip.value ? 'secondary' : 'ghost'}
            aria-pressed={status === chip.value}
            onClick={() => setStatus(chip.value)}
          >
            {chip.label}
            <span className="dshx:text-muted-foreground dshx:tabular-nums">{(data?.statusCounts[chip.value] ?? 0).toLocaleString()}</span>
          </Button>
        ))}
      </div>
      {notice === null ? null : (
        <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
          {notice}
        </p>
      )}
      {page.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(page.error, 'Requests could not be loaded.')}</p> : null}
      <div className="dshx:overflow-x-auto">
        <Table className="dshx:min-w-[880px] dshx:text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="dshx:uppercase">Model</TableHead>
              <SortableHead column="startedAt" label="When" sort={sort} onSort={onSort} className="dshx:text-left" />
              <TableHead className="dshx:uppercase">Project</TableHead>
              <SortableHead column="input" label="Input" sort={sort} onSort={onSort} />
              <SortableHead column="cacheRead" label="Cache read" sort={sort} onSort={onSort} />
              <SortableHead column="output" label="Output" sort={sort} onSort={onSort} />
              <SortableHead column="cost" label="Cost" sort={sort} onSort={onSort} />
              <SortableHead column="durationMs" label="Duration" sort={sort} onSort={onSort} />
              <SortableHead column="ttftMs" label="TTFT" sort={sort} onSort={onSort} />
              <TableHead className="dshx:uppercase">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data !== undefined && data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="dshx:py-6 dshx:text-center dshx:text-muted-foreground">
                  No requests in this range.
                </TableCell>
              </TableRow>
            ) : null}
            {data?.rows.map(row => (
              <TableRow key={row.id} className="dshx:cursor-pointer" data-session-id={row.sessionId} onClick={() => open(row)}>
                <TableCell className="dshx:max-w-56">
                  <button
                    type="button"
                    className="dshx:flex dshx:max-w-full dshx:flex-col dshx:text-left dshx:hover:underline"
                    title={`Open ${threadLabel(row)}`}
                    aria-label={`${row.model} on ${row.provider}: open ${threadLabel(row)}`}
                    onClick={event => {
                      event.stopPropagation()
                      open(row)
                    }}
                  >
                    <span className="dshx:truncate dshx:font-medium">{row.model.length === 0 ? 'unknown model' : row.model}</span>
                    <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                      {row.provider}
                      {row.purpose === 'agent' ? '' : ` · ${UsageFormattingModel.purposeLabels[row.purpose]}`}
                    </span>
                  </button>
                </TableCell>
                <TableCell className="dshx:whitespace-nowrap" title={new Date(row.startedAt).toLocaleString()}>
                  {UsageFormattingModel.formatAgo(row.startedAt, now, relativeTime)}
                </TableCell>
                <TableCell className="dshx:max-w-32 dshx:truncate" title={row.cwd ?? undefined}>
                  {row.project ?? '–'}
                </TableCell>
                <TableCell className="dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatCount(row.input)}</TableCell>
                <TableCell className="dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatCount(row.cacheRead)}</TableCell>
                <TableCell className="dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatCount(row.output)}</TableCell>
                <TableCell
                  className="dshx:text-right dshx:tabular-nums"
                  title={row.cost === null && row.input !== null ? 'No catalog price for this route' : undefined}
                >
                  {UsageFormattingModel.formatCost(row.cost)}
                </TableCell>
                <TableCell className="dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatDuration(row.durationMs)}</TableCell>
                <TableCell className="dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatDuration(row.ttftMs)}</TableCell>
                <TableCell>
                  <span className="dshx:flex dshx:flex-col">
                    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
                      <span aria-hidden className={cn('dshx:size-2 dshx:rounded-full', STATUS_DOT[row.status])} />
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="dshx:text-[11px] dshx:text-muted-foreground">{row.errorCode ?? row.stopReason ?? ''}</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
