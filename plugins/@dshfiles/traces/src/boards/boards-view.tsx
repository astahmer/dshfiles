import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, queryOptions, useQuery } from '@dshfiles/plugin-ui/query'
import { z } from 'zod'
import type { TracesAlertsKey, TracesAlertsTranslate } from '../alerts/alerts-locale.js'
import { alertsOwnerMissing } from '../alerts/alerts-queries.js'
import { TraceFormat } from '../format.js'
import { BUILTIN_BOARDS, SLOW_TOOLS_BOARD, type BoardColumn, type BuiltinBoard } from './board-definitions.js'
import { tracesBoardsApi, type BreakdownRow } from './boards-api.js'

type BoardsClient = typeof tracesBoardsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

const BOARD_IDS = BUILTIN_BOARDS.map(board => board.id)

/** The open board, kept across reloads like the rest of the panel's view. */
export const storedBoardId = createStoredValue({ key: 'dshfiles.traces.board.v1', schema: z.string().max(64), fallback: 'slow-tools' })

const boardOf = (id: string): BuiltinBoard => BUILTIN_BOARDS.find(board => board.id === id) ?? SLOW_TOOLS_BOARD

type BoardCopy = { readonly title: TracesAlertsKey; readonly hint: TracesAlertsKey }

const BOARD_COPY = new Map<string, BoardCopy>([
  ['slow-tools', { title: 'board.slow-tools', hint: 'boardHint.slow-tools' }],
  ['failing-plugins', { title: 'board.failing-plugins', hint: 'boardHint.failing-plugins' }],
  ['model-latency', { title: 'board.model-latency', hint: 'boardHint.model-latency' }],
  ['jobs', { title: 'board.jobs', hint: 'boardHint.jobs' }],
  ['jj-commands', { title: 'board.jj-commands', hint: 'boardHint.jj-commands' }],
])

const FALLBACK_COPY: BoardCopy = { title: 'board.slow-tools', hint: 'boardHint.slow-tools' }

export const boardCopyOf = (id: string): BoardCopy => BOARD_COPY.get(id) ?? FALLBACK_COPY

const breakdownQuery = (client: BoardsClient, board: BuiltinBoard, windowMinutes: number) =>
  queryOptions({
    queryKey: ['traces', 'boards', board.id, windowMinutes] as const,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.breakdown({ ...board.query, windowMinutes }, { signal: hostSignal }) }),
    refetchInterval: (query: { readonly state: { readonly error: unknown } }) => (alertsOwnerMissing(query.state.error) ? false : 10_000),
    retry: false,
  })

const numeric = 'dshx:text-right dshx:font-mono dshx:text-xs'

const headerOf = (column: BoardColumn, t: TracesAlertsTranslate): string =>
  column === 'count' ? t('count') : column === 'errorRate' ? t('errorRate') : column === 'measure' ? t('ttft') : column

const cellOf = (column: BoardColumn, row: BreakdownRow): string => {
  if (column === 'count') return String(row.count)
  if (column === 'errorRate') return TraceFormat.percent(row.errorRate)
  if (column === 'p50') return TraceFormat.duration(row.p50Ms)
  if (column === 'p95') return TraceFormat.duration(row.p95Ms)
  if (column === 'p99') return TraceFormat.duration(row.p99Ms)
  return `${TraceFormat.duration(row.measureP50Ms)} · ${TraceFormat.duration(row.measureP95Ms)}`
}

/** What the trace list needs to show one board row's spans: a span name filter, or the attribute pair as text search. */
export type BoardDrillDown = { readonly operation: string } | { readonly search: string }

const drillDownOf = (board: BuiltinBoard, row: BreakdownRow): BoardDrillDown | null => {
  if (row.key === null) return null
  if (board.query.groupBy.kind === 'operation') return { operation: row.key }
  if (board.query.groupBy.kind === 'attribute') return { search: `"${board.query.groupBy.key}":"${row.key}"` }
  return null
}

/** Built-in breakdowns, one table each; a row opens the trace list narrowed to its spans. */
export const BoardsView = (props: {
  readonly windowMinutes: number
  readonly onDrillDown: (drillDown: BoardDrillDown) => void
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  const client = useApi(tracesBoardsApi)
  const boardId = storedBoardId.useValue()
  const board = boardOf(boardId)
  const breakdown = useQuery({ ...breakdownQuery(client, board, props.windowMinutes), placeholderData: keepPreviousData })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3" data-testid="traces-boards-view" data-board={board.id}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={t('board')}
        value={board.id}
        onValueChange={value => {
          if (BOARD_IDS.includes(value)) storedBoardId.set(value)
        }}
        className="dshx:flex-wrap dshx:justify-start"
      >
        {BUILTIN_BOARDS.map(candidate => (
          <ToggleGroupItem key={candidate.id} value={candidate.id} className="dshx:shrink">
            {t(boardCopyOf(candidate.id).title)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="dshx:text-xs dshx:text-muted-foreground">{t(boardCopyOf(board.id).hint)}</p>
      {breakdown.isError ? (
        <Alert variant={alertsOwnerMissing(breakdown.error) ? 'default' : 'destructive'}>
          <AlertDescription>{alertsOwnerMissing(breakdown.error) ? t('alertsUnavailable') : errorMessage(breakdown.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {breakdown.data === undefined ? null : breakdown.data.rows.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">{t('boardEmpty')}</p>
      ) : (
        <Table aria-label={t(boardCopyOf(board.id).title)}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('groupColumn')}</TableHead>
              {board.columns.map(column => (
                <TableHead
                  key={column}
                  className={column === 'measure' ? 'dshx:w-40 dshx:text-right' : 'dshx:w-20 dshx:text-right dshx:@max-pane-narrow:last:hidden'}
                >
                  {headerOf(column, t)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.data.rows.map(row => {
              const drillDown = drillDownOf(board, row)
              return (
                <TableRow
                  key={row.key ?? '\u0000'}
                  data-group={row.key ?? ''}
                  className={drillDown === null ? '' : 'dshx:cursor-pointer'}
                  tabIndex={drillDown === null ? undefined : 0}
                  aria-label={drillDown === null ? undefined : `${t('filterByGroup')}: ${row.key ?? ''}`}
                  onClick={() => {
                    if (drillDown !== null) props.onDrillDown(drillDown)
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && drillDown !== null) props.onDrillDown(drillDown)
                  }}
                >
                  <TableCell className="dshx:max-w-0">
                    <span className="dshx:block dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{row.key ?? t('groupUnset')}</span>
                  </TableCell>
                  {board.columns.map(column => (
                    <TableCell
                      key={column}
                      className={cn(
                        numeric,
                        column === 'errorRate' && row.errorCount > 0 && 'dshx:text-destructive',
                        column !== 'measure' && 'dshx:@max-pane-narrow:last:hidden',
                      )}
                    >
                      {cellOf(column, row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {breakdown.data?.truncated === true ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('boardTruncated')}</p> : null}
    </div>
  )
}
