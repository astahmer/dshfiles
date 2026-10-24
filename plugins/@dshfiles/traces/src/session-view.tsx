import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { ArrowLeftIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useInfiniteQuery, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { tracesApi, type LogsInput } from './api.js'
import { TraceFormat } from './format.js'
import type { TracesLocaleKey, TracesTranslate } from './locales.js'
import { LogRow, type LogCorrelation } from './log-list.js'
import { tracesQueries } from './queries.js'
import { EmptyStoreGuide, receiverEndpoint } from './receiver-status.js'
import { TraceDetailView } from './trace-detail.js'
import { TraceList } from './trace-list.js'
import type { SessionSummary } from './types.js'

const countFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const pair = (left: number | null, right: number | null): string =>
  `${left === null ? '–' : TraceFormat.duration(left)} · ${right === null ? '–' : TraceFormat.duration(right)}`

const Stat = (props: { readonly label: TracesLocaleKey; readonly value: string; readonly tone?: 'error'; readonly t: TracesTranslate }): JSX.Element => (
  <div
    className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2.5 dshx:py-1.5"
    data-stat={props.label}
  >
    <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{props.t(props.label)}</span>
    <span className={cn('dshx:truncate dshx:font-mono dshx:text-sm', props.tone === 'error' ? 'dshx:text-destructive' : '')}>{props.value}</span>
  </div>
)

const SummaryGrid = (props: { readonly summary: SessionSummary; readonly t: TracesTranslate }): JSX.Element => {
  const summary = props.summary
  const tokens = summary.tokens
  return (
    <section
      aria-label={props.t('sessionSummaryLabel')}
      data-testid="traces-session-summary"
      className="dshx:grid dshx:grid-cols-4 dshx:gap-2 dshx:@max-pane-compact:grid-cols-3 dshx:@max-pane-narrow:grid-cols-2"
    >
      <Stat label="statTraces" value={String(summary.traces)} t={props.t} />
      <Stat label="statSpans" value={String(summary.spans)} t={props.t} />
      <Stat label="statErrors" value={String(summary.errorSpans)} {...(summary.errorSpans > 0 ? { tone: 'error' } : {})} t={props.t} />
      <Stat label="statTotalTime" value={TraceFormat.duration(summary.totalTraceMs)} t={props.t} />
      <Stat label="statModelCalls" value={String(summary.modelCalls)} t={props.t} />
      <Stat label="statToolCalls" value={String(summary.toolCalls)} t={props.t} />
      <Stat label="statTraceLatency" value={pair(summary.traceLatency.p50Ms, summary.traceLatency.p95Ms)} t={props.t} />
      {summary.modelCalls === 0 ? null : <Stat label="statModelLatency" value={pair(summary.modelLatency.p50Ms, summary.modelLatency.p95Ms)} t={props.t} />}
      {tokens === null ? null : (
        <Stat
          label="statTokens"
          value={`${countFormat.format(tokens.input)} · ${countFormat.format(tokens.output)}${tokens.cacheRead > 0 ? ` (${countFormat.format(tokens.cacheRead)} ${props.t('statCacheRead')})` : ''}`}
          t={props.t}
        />
      )}
      {/* An older Host omits costUsd until it restarts. */}
      {(summary.costUsd ?? null) === null ? null : <Stat label="statCost" value={TraceFormat.usd(summary.costUsd)} t={props.t} />}
    </section>
  )
}

type Section = 'turns' | 'logs'

/** The current thread's telemetry: traces carrying its dsh.session.id, a waterfall per trace, its logs and a summary. */
export const SessionTracesView = (props: { readonly sessionId: string; readonly t: TracesTranslate }): JSX.Element => {
  const t = props.t
  const client = useApi(tracesApi)
  const [section, setSection] = useState<Section>('turns')
  const [traceId, setTraceId] = useState<string | null>(null)
  const [correlation, setCorrelation] = useState<LogCorrelation | null>(null)
  const summaryQuery = useQuery({ ...tracesQueries.sessionSummary(client, props.sessionId), placeholderData: keepPreviousData })
  const statusQuery = useQuery(tracesQueries.status(client))
  const listQuery = useInfiniteQuery({
    ...tracesQueries.list(client, { sessionId: props.sessionId, limit: 30 }),
    placeholderData: keepPreviousData,
    enabled: section === 'turns' && traceId === null,
  })
  const traceQuery = useQuery({ ...tracesQueries.trace(client, traceId ?? ''), enabled: traceId !== null })
  // dshx API payloads refuse undefined values, so absent filters are omitted rather than sent as undefined.
  const logFilters: Omit<LogsInput, 'cursor'> = { sessionId: props.sessionId, limit: 50 }
  if (correlation !== null) {
    logFilters.traceId = correlation.traceId
    if (correlation.spanId !== null) logFilters.spanId = correlation.spanId
  }
  const logsQuery = useInfiniteQuery({ ...tracesQueries.logs(client, logFilters), placeholderData: keepPreviousData, enabled: section === 'logs' })

  const summary = summaryQuery.data
  const traces = listQuery.data?.pages.flatMap(page => page.traces) ?? []
  const logs = logsQuery.data?.pages.flatMap(page => page.logs) ?? []
  const empty = summary === undefined ? listQuery.isSuccess && traces.length === 0 : summary.traces === 0
  const openTrace = (openedTraceId: string): void => {
    setSection('turns')
    setTraceId(openedTraceId)
  }

  return (
    <main
      className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-4 dshx:@max-pane-narrow:p-2"
      data-testid="traces-session-view"
      data-session-id={props.sessionId}
      data-receiver-endpoint={
        statusQuery.data === undefined || statusQuery.data.state !== 'listening' ? undefined : (receiverEndpoint(statusQuery.data) ?? undefined)
      }
    >
      {empty ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2" data-testid="traces-session-empty">
          <Alert>
            <AlertTitle>{t('sessionEmptyTitle')}</AlertTitle>
            <AlertDescription>{t('sessionEmptyBody')}</AlertDescription>
          </Alert>
          {statusQuery.data === undefined ? null : <EmptyStoreGuide status={statusQuery.data} compact t={t} />}
        </div>
      ) : (
        <>
          {summary === undefined ? null : <SummaryGrid summary={summary} t={t} />}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label={t('sessionSections')}
              value={section}
              onValueChange={value => {
                if (value === 'turns' || value === 'logs') setSection(value)
              }}
            >
              <ToggleGroupItem value="turns">{t('sectionTurns')}</ToggleGroupItem>
              <ToggleGroupItem value="logs">{t('tabLogs')}</ToggleGroupItem>
            </ToggleGroup>
            {section === 'logs' && correlation !== null ? (
              <Button variant="secondary" size="sm" onClick={() => setCorrelation(null)} aria-label={t('clearCorrelation')}>
                {correlation.spanId === null ? t('logsOfTrace') : t('logsOfSpan')}: {(correlation.spanId ?? correlation.traceId).slice(0, 12)}… ✕
              </Button>
            ) : null}
            {section === 'turns' && traceId !== null ? (
              <Button variant="ghost" size="sm" onClick={() => setTraceId(null)}>
                <ArrowLeftIcon /> {t('back')}
              </Button>
            ) : null}
          </div>
          {section === 'turns' && traceId === null ? (
            <>
              {listQuery.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage(listQuery.error, t('loadFailed'))}</AlertDescription>
                </Alert>
              ) : null}
              <TraceList
                traces={traces}
                hasMore={listQuery.hasNextPage}
                loadingMore={listQuery.isFetchingNextPage}
                onLoadMore={() => void listQuery.fetchNextPage()}
                onOpen={setTraceId}
                t={t}
              />
            </>
          ) : null}
          {section === 'turns' && traceId !== null ? (
            <>
              {traceQuery.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{t('traceNotFound')}</AlertDescription>
                </Alert>
              ) : null}
              {traceQuery.data === undefined ? null : (
                <TraceDetailView
                  key={traceQuery.data.traceId}
                  trace={traceQuery.data}
                  onShowLogs={spanId => {
                    setCorrelation({ traceId: traceQuery.data.traceId, spanId })
                    setSection('logs')
                  }}
                  t={t}
                />
              )}
            </>
          ) : null}
          {section === 'logs' ? (
            <>
              {logsQuery.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage(logsQuery.error, t('loadFailed'))}</AlertDescription>
                </Alert>
              ) : null}
              {logs.length === 0 && logsQuery.isSuccess ? (
                <p className="dshx:text-sm dshx:text-muted-foreground">{t('noSessionLogs')}</p>
              ) : (
                <ul className="dshx:flex dshx:flex-col" aria-label={t('tabLogs')}>
                  {logs.map(log => (
                    <LogRow key={log.id} log={log} onOpenTrace={openTrace} t={t} />
                  ))}
                </ul>
              )}
              {logsQuery.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="dshx:self-center"
                  disabled={logsQuery.isFetchingNextPage}
                  onClick={() => void logsQuery.fetchNextPage()}
                >
                  {t('loadMoreLogs')}
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </main>
  )
}
