import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { AgentTimeline } from '@dshfiles/plugin-ui/components/motion/agent-timeline'
import { RollingNumber } from '@dshfiles/plugin-ui/components/motion/text'
import { ChatFocusModel } from '@dshfiles/chat/chat-focus'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowLeftIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Types } from 'effect'
import { tracesApi, type LogsInput } from './api.js'
import type { OpenThread } from './open-thread.js'
import { ThreadLinks } from './thread-links.js'
import { TraceFormat } from './format.js'
import type { TracesLocaleKey, TracesTranslate } from './locales.js'
import { LogRow, type LogCorrelation } from './log-list.js'
import { tracesQueries } from './queries.js'
import { EmptyStoreGuide, receiverEndpoint } from './receiver-status.js'
import { SessionReadingModel, TURN_TRACE_RETRY_MS, type SessionReading } from './session-reading.js'
import { SessionTimelineModel } from './session-timeline.js'
import { TraceDetailView } from './trace-detail.js'
import { TraceList } from './trace-list.js'
import type { SessionSummary, TraceDetail } from './types.js'

const countFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
/** The newest traces the turn timeline draws; older turns stay one click away in the list below it. */
const TIMELINE_TRACES = 20
const TIMELINE_STALE_MS = 30_000

const pair = (left: number | null, right: number | null): string =>
  `${left === null ? '–' : TraceFormat.duration(left)} · ${right === null ? '–' : TraceFormat.duration(right)}`

const Stat = (props: { readonly label: TracesLocaleKey; readonly value: ReactNode; readonly tone?: 'error'; readonly t: TracesTranslate }): JSX.Element => (
  <div
    className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2.5 dshx:py-1.5"
    data-stat={props.label}
  >
    <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{props.t(props.label)}</span>
    <span className={cn('dshx:truncate dshx:font-mono dshx:text-sm', props.tone === 'error' ? 'dshx:text-destructive' : '')}>{props.value}</span>
  </div>
)

/** An integer stat whose changed digits roll; String keeps the text the summary always showed (no grouping). */
const count = (value: number): JSX.Element => <RollingNumber value={value} format={String} />

const SummaryGrid = (props: { readonly summary: SessionSummary; readonly t: TracesTranslate }): JSX.Element => {
  const summary = props.summary
  const tokens = summary.tokens
  return (
    <section
      aria-label={props.t('sessionSummaryLabel')}
      data-testid="traces-session-summary"
      className="dshx:grid dshx:grid-cols-4 dshx:gap-2 dshx:@max-pane-compact:grid-cols-3 dshx:@max-pane-narrow:grid-cols-2"
    >
      <Stat label="statTraces" value={count(summary.traces)} t={props.t} />
      <Stat label="statSpans" value={count(summary.spans)} t={props.t} />
      <Stat label="statErrors" value={count(summary.errorSpans)} {...(summary.errorSpans > 0 ? { tone: 'error' } : {})} t={props.t} />
      <Stat label="statTotalTime" value={TraceFormat.duration(summary.totalTraceMs)} t={props.t} />
      <Stat label="statModelCalls" value={count(summary.modelCalls)} t={props.t} />
      <Stat label="statToolCalls" value={count(summary.toolCalls)} t={props.t} />
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

/** A stable combine keeps one array while no trace query changed, so the timeline memo holds. */
const loadedTraces = (results: readonly { readonly data?: TraceDetail | undefined }[]): readonly TraceDetail[] =>
  results.flatMap(result => (result.data === undefined ? [] : [result.data]))

/** The thread's newest traces as one timeline of turns, model calls and tool calls. */
const TurnTimeline = (props: { readonly traces: readonly TraceDetail[]; readonly t: TracesTranslate }): JSX.Element | null => {
  const t = props.t
  const timeline = useMemo(
    () =>
      SessionTimelineModel.build({
        traces: props.traces,
        laneNames: { turns: t('sectionTurns'), model: t('statModelCalls'), tools: t('statToolCalls') },
      }),
    [props.traces, t],
  )
  if (timeline.segments.length === 0) return null
  return (
    <AgentTimeline
      heading={t('sessionTimeline')}
      lanes={timeline.lanes}
      segments={timeline.segments}
      duration={timeline.duration}
      autoPlay={false}
      legend={[
        { label: t('statModelCalls'), swatch: 'soft' },
        { label: t('statToolCalls'), swatch: 'solid' },
        { label: t('statErrors'), swatch: 'failed' },
      ]}
      labels={{ running: t('timelineRunning'), done: t('timelineDone'), failed: t('timelineFailed'), tokens: t('timelineTokens'), lanes: t('timelineLanes') }}
      data-testid="traces-session-timeline"
    />
  )
}

type Section = 'turns' | 'logs'

/** The native Conversation View props this tab reads; absent on a Host shell without View focus requests. */
type ConversationViewProps = Partial<Pick<ConvViewOwnerProps, 'viewRequest' | 'openView' | 'completeViewRequest'>>

/** The current thread's telemetry: traces carrying its dsh.session.id, a waterfall per trace, its logs and a summary. */
export const SessionTracesView = (
  props: ConversationViewProps & { readonly sessionId: string; readonly openThread: OpenThread; readonly t: TracesTranslate },
): JSX.Element => {
  const t = props.t
  const client = useApi(tracesApi)
  const [section, setSection] = useState<Section>('turns')
  const [reading, setReading] = useState<SessionReading>(SessionReadingModel.idle())
  const [correlation, setCorrelation] = useState<LogCorrelation | null>(null)
  const { viewRequest, completeViewRequest, openView, sessionId } = props

  // A Turn footer's Trace button addresses this tab with one of the thread's turns.
  useEffect(() => {
    if (viewRequest === null || viewRequest === undefined || viewRequest.view !== ThreadLinks.viewId) return
    completeViewRequest?.()
    const focus = ThreadLinks.decodeFocus(viewRequest.focus)
    if (focus === null) return
    setSection('turns')
    setReading(SessionReadingModel.seek({ turn: focus.turn, now: Date.now() }))
  }, [viewRequest, completeViewRequest])

  // A panel that opened this thread for Chat while it reopened on this tab: hand the focus on to Chat.
  useEffect(() => {
    if (openView === undefined) return
    const pending = ChatFocusModel.take(sessionId)
    if (pending !== null) openView(ChatFocusModel.viewId, ChatFocusModel.encode(pending))
  }, [sessionId, openView])

  // A just-finished turn is exported a moment later, so the lookup retries for a while before saying it has no trace.
  const seekingTurn = SessionReadingModel.seekingTurn(reading)
  const turnQuery = useQuery({
    ...tracesQueries.turnTrace(client, { sessionId, turn: seekingTurn ?? 0 }),
    enabled: seekingTurn !== null,
    refetchInterval: TURN_TRACE_RETRY_MS,
  })
  useEffect(() => {
    if (seekingTurn === null || turnQuery.isFetching || turnQuery.isPending) return
    setReading(current =>
      SessionReadingModel.settle({ reading: current, foundTraceId: turnQuery.data?.traces[0]?.traceId ?? null, failed: turnQuery.isError, now: Date.now() }),
    )
  }, [seekingTurn, turnQuery.isFetching, turnQuery.isPending, turnQuery.isError, turnQuery.data, turnQuery.dataUpdatedAt])
  const traceId = SessionReadingModel.traceId(reading)
  const pendingTurn = SessionReadingModel.seekingTurn(reading)
  const missingTurn = SessionReadingModel.missingTurn(reading)

  const showInThread: OpenThread = target => {
    if (target.sessionId !== sessionId || openView === undefined) return props.openThread(target)
    openView(ChatFocusModel.viewId, target.focus === null ? '' : ChatFocusModel.encode(target.focus))
    return null
  }
  const summaryQuery = useQuery({ ...tracesQueries.sessionSummary(client, props.sessionId), placeholderData: keepPreviousData })
  const statusQuery = useQuery(tracesQueries.status(client))
  const listQuery = useInfiniteQuery({
    ...tracesQueries.list(client, { sessionId: props.sessionId, limit: 30 }),
    placeholderData: keepPreviousData,
    enabled: section === 'turns' && traceId === null,
  })
  const traceQuery = useQuery({ ...tracesQueries.trace(client, traceId ?? ''), enabled: traceId !== null })
  const timelineIds = (listQuery.data?.pages.flatMap(page => page.traces) ?? []).slice(0, TIMELINE_TRACES).map(trace => trace.traceId)
  const timelineTraces = useQueries({
    queries: timelineIds.map(id => ({
      ...tracesQueries.trace(client, id),
      refetchInterval: false as const,
      staleTime: TIMELINE_STALE_MS,
      enabled: section === 'turns' && traceId === null,
    })),
    combine: loadedTraces,
  })
  // dshx API payloads refuse undefined values, so absent filters are omitted rather than sent as undefined.
  const logFilters: Types.Mutable<Omit<LogsInput, 'cursor'>> = { sessionId: props.sessionId, limit: 50 }
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
    setReading(SessionReadingModel.open(openedTraceId))
  }

  return (
    <TooltipProvider>
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
                <Button variant="ghost" size="sm" onClick={() => setReading(SessionReadingModel.idle())}>
                  <ArrowLeftIcon /> {t('back')}
                </Button>
              ) : null}
            </div>
            {pendingTurn === null ? null : (
              <p className="dshx:text-sm dshx:text-muted-foreground" data-testid="traces-turn-pending">
                {t('turnTraceLoading', { turn: pendingTurn })}
              </p>
            )}
            {missingTurn === null ? null : (
              <Alert data-testid="traces-turn-missing">
                <AlertDescription>{t('turnTraceMissing', { turn: missingTurn })}</AlertDescription>
              </Alert>
            )}
            {section === 'turns' && traceId === null ? (
              <>
                {listQuery.isError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                      <span className="dshx:min-w-0 dshx:flex-1">{errorMessage(listQuery.error, t('loadFailed'))}</span>
                      <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                        {t('retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <TurnTimeline traces={timelineTraces} t={t} />
                <TraceList
                  traces={traces}
                  hasMore={listQuery.hasNextPage}
                  loadingMore={listQuery.isFetchingNextPage}
                  onLoadMore={() => void listQuery.fetchNextPage()}
                  onOpen={openedTraceId => setReading(SessionReadingModel.open(openedTraceId))}
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
                    onOpenThread={showInThread}
                    currentSessionId={sessionId}
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
                    <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                      <span className="dshx:min-w-0 dshx:flex-1">{errorMessage(logsQuery.error, t('loadFailed'))}</span>
                      <Button variant="outline" size="sm" onClick={() => void logsQuery.refetch()}>
                        {t('retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {logs.length === 0 && logsQuery.isSuccess ? (
                  <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">{t('noSessionLogs')}</EmptyState>
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
    </TooltipProvider>
  )
}
