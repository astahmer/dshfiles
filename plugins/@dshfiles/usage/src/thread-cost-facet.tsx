import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, PageSection } from '@dshfiles/plugin-ui/components/page'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { usageApi, type RequestView } from './api.js'
import { UsageFormattingModel } from './format.js'

const DAY_MS = 86_400_000
/** One thread rarely spans a year; the facet reads its newest requests within that window. */
const WINDOW_DAYS = 365
const LIMIT = 500

export interface ThreadCostTurn {
  /** null: requests without a turn (titles, memory, side calls). */
  readonly turn: number | null
  readonly requests: number
  readonly cost: number | null
  readonly tokens: number
  readonly models: readonly string[]
  readonly failed: number
}

/** Requests of one thread folded per turn, newest turn first; side requests last. */
const turnsOf = (rows: readonly RequestView[]): readonly ThreadCostTurn[] => {
  const byTurn = new Map<number | null, { requests: number; cost: number | null; tokens: number; models: Set<string>; failed: number }>()
  for (const row of rows) {
    const entry = byTurn.get(row.turn) ?? { requests: 0, cost: null, tokens: 0, models: new Set<string>(), failed: 0 }
    entry.requests += 1
    if (row.cost !== null) entry.cost = (entry.cost ?? 0) + row.cost
    entry.tokens += (row.input ?? 0) + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0) + (row.output ?? 0)
    entry.models.add(row.model)
    if (row.status === 'failed') entry.failed += 1
    byTurn.set(row.turn, entry)
  }
  return [...byTurn]
    .map(([turn, entry]) => ({
      turn,
      requests: entry.requests,
      cost: entry.cost,
      tokens: entry.tokens,
      models: [...entry.models].sort(),
      failed: entry.failed,
    }))
    .sort((left, right) => (left.turn === null ? 1 : right.turn === null ? -1 : right.turn - left.turn))
}

const money = (value: number | null): string => UsageFormattingModel.formatCost(value)

/**
 * The thread panel's Cost facet (plans/ade-ux §4.4): the route the thread's last request took, what each turn cost,
 * and links to this thread's requests (Usage › Requests, filtered) and to Traces. Costs are list-price estimates.
 */
export const ThreadCostFacet = (props: {
  readonly sessionId: string
  readonly onShowRequests: (sessionId: string) => void
  readonly onOpenTraces: () => void
  readonly onOpenAccount: (accountId: string) => void
}): JSX.Element => {
  const api = useApi(usageApi)
  const [readAt] = useState(() => Date.now())
  const query = useMemo(
    () => ({
      from: readAt - WINDOW_DAYS * DAY_MS,
      to: readAt + DAY_MS,
      sessionId: props.sessionId,
      sort: 'startedAt' as const,
      direction: 'desc' as const,
      limit: LIMIT,
    }),
    [props.sessionId, readAt],
  )
  const page = useQuery({
    queryKey: ['dshfiles-usage', 'thread-cost', query],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.requests(query, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 1,
  })
  const rows = page.data?.rows ?? []
  const turns = useMemo(() => turnsOf(rows), [rows])
  const total = rows.reduce<number | null>((sum, row) => (row.cost === null ? sum : (sum ?? 0) + row.cost), null)
  const last = rows[0]

  return (
    <div
      className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:p-3"
      data-thread-facet="cost"
    >
      <PageSection
        heading="Cost"
        meta={page.data === undefined ? undefined : `${money(total)} · ${String(page.data.total)} requests`}
        description="List-price estimates of this thread's model requests, side calls included."
        actions={
          <>
            <Button size="xs" variant="outline" onClick={() => props.onShowRequests(props.sessionId)}>
              Requests
            </Button>
            <Button size="xs" variant="ghost" onClick={props.onOpenTraces}>
              Traces
            </Button>
          </>
        }
      />
      {page.isPending ? (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <Spinner className="dshx:size-3.5" />
          Reading this thread's requests…
        </p>
      ) : null}
      {page.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span className="dshx:min-w-0 dshx:flex-1">{errorMessage(page.error, 'Usage could not be read.')}</span>
            <Button size="xs" variant="outline" onClick={() => void page.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {page.isSuccess && rows.length === 0 ? (
        <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">
          No model requests recorded for this thread yet. Usage indexes thread logs every few seconds; send a message and they show here.
        </EmptyState>
      ) : null}
      {last === undefined ? null : (
        <PageSection heading="Route" description="The account and model the last request used.">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm">
            <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{last.model}</span>
            <span className="dshx:text-muted-foreground">via</span>
            <span className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs">{last.provider}</span>
            <Button size="xs" variant="ghost" onClick={() => props.onOpenAccount(last.provider)}>
              Quota
            </Button>
          </div>
        </PageSection>
      )}
      {turns.length === 0 ? null : (
        <PageSection heading="Per turn" meta={turns.length}>
          <table className="dshx:w-full dshx:text-xs">
            <thead>
              <tr className="dshx:text-muted-foreground">
                <th className="dshx:py-1 dshx:text-left dshx:font-normal">Turn</th>
                <th className="dshx:py-1 dshx:text-right dshx:font-normal">Requests</th>
                <th className="dshx:py-1 dshx:text-right dshx:font-normal">Tokens</th>
                <th className="dshx:py-1 dshx:text-right dshx:font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {turns.map(turn => (
                <tr key={turn.turn ?? 'side'} className="dshx:border-t dshx:border-border/60">
                  <td className="dshx:py-1.5 dshx:pr-2">
                    <span className="dshx:block">{turn.turn === null ? 'Side requests' : `Turn ${String(turn.turn)}`}</span>
                    <span className="dshx:block dshx:truncate dshx:text-muted-foreground">
                      {turn.models.join(', ')}
                      {turn.failed === 0 ? '' : ` · ${String(turn.failed)} failed`}
                    </span>
                  </td>
                  <td className="dshx:py-1.5 dshx:text-right dshx:tabular-nums">{turn.requests}</td>
                  <td className="dshx:py-1.5 dshx:text-right dshx:tabular-nums">{UsageFormattingModel.formatCount(turn.tokens)}</td>
                  <td className="dshx:py-1.5 dshx:text-right dshx:tabular-nums">{money(turn.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {page.data !== undefined && page.data.total > rows.length ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">Showing the latest {rows.length} requests; Requests lists them all.</p>
          ) : null}
        </PageSection>
      )}
    </div>
  )
}

export class ThreadCost {
  static readonly turnsOf = turnsOf
}
