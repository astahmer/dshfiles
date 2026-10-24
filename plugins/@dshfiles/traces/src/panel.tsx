import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ArrowLeftIcon, RefreshCwIcon, ScrollTextIcon, SearchIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { FiringAlertsBanner, FiringAlertsCount } from './alerts/alert-badges.js'
import type { TracesAlertsTranslate } from './alerts/alerts-locale.js'
import { AlertsView, useFiringCount } from './alerts/alerts-view.js'
import { tracesApi, type ListInput } from './api.js'
import { BoardsView } from './boards/boards-view.js'
import { SavedViewsMenu } from './boards/saved-views.js'
import { ErrorGroups, OperationsTable, ServiceStrip } from './insights.js'
import type { TracesTranslate } from './locales.js'
import { tracesKeys, tracesQueries } from './queries.js'
import { EmptyStoreGuide, exportBlocked, ReceiverBadge, ReceiverMessage } from './receiver-status.js'
import { TraceDetailView } from './trace-detail.js'
import { LogsView, type LogCorrelation } from './log-list.js'
import { MetricsView } from './metrics-view.js'
import { ModelCostTable } from './model-costs.js'
import { ServiceMapView } from './service-map.js'
import { TraceList } from './trace-list.js'
import { storedTracesView, tracesViewSchema, WINDOW_OPTIONS, type TracesView } from './view-state.js'

const ALL = '__all__'

const windowLabel = (minutes: number, t: TracesTranslate): string =>
  minutes === 15 ? t('window15m') : minutes === 60 ? t('window1h') : minutes === 1_440 ? t('window24h') : t('window7d')

export const TracesPanel = (props: {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly uiWorkspace: UiWorkspace
  readonly t: TracesTranslate
  readonly tAlerts: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  const client = useApi(tracesApi)
  const firing = useFiringCount()
  const queryClient = useQueryClient()
  const view = storedTracesView.useValue()
  const [traceId, setTraceId] = useState<string | null>(null)
  const [logCorrelation, setLogCorrelation] = useState<LogCorrelation | null>(null)
  const showLogs = (correlation: LogCorrelation): void => {
    setLogCorrelation(correlation)
    update({ tab: 'logs' })
  }
  const update = (patch: Partial<TracesView> & { readonly traceId?: string | null }): void => {
    const { traceId: nextTraceId, ...stored } = patch
    if (nextTraceId !== undefined) setTraceId(nextTraceId)
    if (Object.keys(stored).length > 0) storedTracesView.set({ ...view, ...stored })
  }
  const search = useDebouncedValue({ value: view.search.trim(), delayMs: 250 })
  // dshx API payloads refuse undefined values, so absent filters are omitted rather than sent as undefined.
  const filters: Omit<ListInput, 'cursor'> = { limit: 50 }
  if (search.length > 0) filters.search = search
  if (view.service !== null) filters.service = view.service
  if (view.operation !== null) filters.operation = view.operation
  if (view.status !== 'all') filters.status = view.status
  if (view.minDurationMs !== null) filters.minDurationMs = view.minDurationMs
  const statusQuery = useQuery(tracesQueries.status(client))
  const statsQuery = useQuery({ ...tracesQueries.stats(client, view.windowMinutes), placeholderData: keepPreviousData })
  const listQuery = useInfiniteQuery({ ...tracesQueries.list(client, filters), placeholderData: keepPreviousData, enabled: traceId === null })
  const traceQuery = useQuery({ ...tracesQueries.trace(client, traceId ?? ''), enabled: traceId !== null })
  const errorsQuery = useQuery({ ...tracesQueries.errors(client, view.windowMinutes), enabled: view.tab === 'errors' })
  const mapQuery = useQuery({ ...tracesQueries.serviceMap(client, view.windowMinutes), enabled: view.tab === 'map', placeholderData: keepPreviousData })
  const clearMutation = useMutation({
    mutationFn: () => client.clear({ confirm: true }),
    onSuccess: () => {
      update({ traceId: null })
      return queryClient.invalidateQueries({ queryKey: tracesKeys.all })
    },
  })

  const openThread = (sessionId: string): string | null => {
    const workspaceList = props.workspaces.list.getSnapshot()
    if (workspaceList.phase === 'ready' && workspaceList.archivedSessionIds.some(archivedId => archivedId === sessionId)) return t('threadUnavailable')
    const sessionList = props.sessions.list.getSnapshot()
    const availableId = sessionList.ids.find(candidate => candidate === sessionId)
    const session = availableId === undefined ? undefined : sessionList.byId[availableId]
    if (session === undefined) return t('threadUnavailable')
    props.uiWorkspace.openSession(session.id)
    return null
  }

  const status = statusQuery.data
  const traces = listQuery.data?.pages.flatMap(page => page.traces) ?? []
  const filtered = search.length > 0 || view.service !== null || view.operation !== null || view.status !== 'all' || view.minDurationMs !== null
  const storeEmpty = status !== undefined && status.store.traces === 0 && status.store.logs === 0 && status.store.metricPoints === 0
  const services = statsQuery.data?.services.map(service => service.service) ?? []

  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-5 dshx:@max-pane-narrow:p-3">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <h1 className="dshx:text-lg dshx:font-semibold">{t('title')}</h1>
          <p className="dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{t('subtitle')}</p>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          {status === undefined ? null : <ReceiverBadge status={status} t={t} />}
          {status === undefined ? null : (
            <span className="dshx:text-xs dshx:text-muted-foreground" data-testid="traces-store-summary">
              {status.store.traces} {t('traces')} · {status.store.spans} {t('spans')} · {status.store.logs} {t('logs')} {t('storedSummary')}
            </span>
          )}
          <SavedViewsMenu t={props.tAlerts} />
          <Button variant="outline" size="sm" aria-label={t('refresh')} onClick={() => void queryClient.invalidateQueries({ queryKey: tracesKeys.all })}>
            <RefreshCwIcon />
            <span className="dshx:@max-pane-compact:sr-only">{t('refresh')}</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" aria-label={t('clear')} disabled={storeEmpty || clearMutation.isPending}>
                <Trash2Icon />
                <span className="dshx:@max-pane-compact:sr-only">{t('clear')}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('clearTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {status === undefined
                    ? ''
                    : `${String(status.store.traces)} ${t('traces')} · ${String(status.store.spans)} ${t('spans')} · ${String(status.store.logs)} ${t('logs')}. `}
                  {t('clearDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearMutation.mutate()}>{t('clearConfirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {status === undefined ? null : <ReceiverMessage status={status} t={t} />}
      {statusQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(statusQuery.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {status !== undefined && (storeEmpty || exportBlocked(status)) ? <EmptyStoreGuide status={status} compact={!storeEmpty} t={t} /> : null}

      {statsQuery.data === undefined ? null : (
        <ServiceStrip stats={statsQuery.data} onPick={service => update({ service, operation: null, tab: 'traces', traceId: null })} t={t} />
      )}

      <FiringAlertsBanner firing={view.tab === 'alerts' ? null : firing} onShow={() => update({ tab: 'alerts' })} t={props.tAlerts} />

      <Tabs value={view.tab} onValueChange={value => update({ tab: tracesViewSchema.shape.tab.parse(value) })} className="dshx:min-h-0 dshx:flex-1">
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
          <TabsList className="dshx:max-w-full dshx:justify-start dshx:overflow-x-auto">
            <TabsTrigger value="traces">{t('tabTraces')}</TabsTrigger>
            <TabsTrigger value="logs">{t('tabLogs')}</TabsTrigger>
            <TabsTrigger value="map">{t('tabMap')}</TabsTrigger>
            <TabsTrigger value="metrics">{t('tabMetrics')}</TabsTrigger>
            <TabsTrigger value="operations">{t('tabOperations')}</TabsTrigger>
            <TabsTrigger value="errors">{t('tabErrors')}</TabsTrigger>
            <TabsTrigger value="boards">{props.tAlerts('tabBoards')}</TabsTrigger>
            <TabsTrigger value="alerts">
              {props.tAlerts('tabAlerts')} <FiringAlertsCount firing={firing} />
            </TabsTrigger>
          </TabsList>
          {view.tab === 'traces' || view.tab === 'logs' || view.tab === 'alerts' ? null : (
            <Select value={String(view.windowMinutes)} onValueChange={value => update({ windowMinutes: Number(value) })}>
              <SelectTrigger size="sm" aria-label={t('window')} className="dshx:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map(minutes => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {windowLabel(minutes, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <TabsContent value="traces" className="dshx:flex dshx:flex-col dshx:gap-3">
          {traceId === null ? (
            <>
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                <InputGroup className="dshx:w-72 dshx:max-w-full dshx:@max-pane-narrow:w-full">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label={t('search')}
                    placeholder={t('searchPlaceholder')}
                    value={view.search}
                    onChange={event => update({ search: event.target.value })}
                  />
                </InputGroup>
                <Select value={view.service ?? ALL} onValueChange={value => update({ service: value === ALL ? null : value })}>
                  <SelectTrigger size="sm" aria-label={t('service')} className="dshx:w-44 dshx:@max-pane-narrow:w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allServices')}</SelectItem>
                    {[...new Set([...(view.service === null ? [] : [view.service]), ...services])].map(service => (
                      <SelectItem key={service} value={service}>
                        {service}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-label={t('status')}
                  value={view.status}
                  onValueChange={value => update({ status: value === 'error' || value === 'ok' ? value : 'all' })}
                >
                  <ToggleGroupItem value="all">{t('allStatuses')}</ToggleGroupItem>
                  <ToggleGroupItem value="error">{t('errorsOnly')}</ToggleGroupItem>
                  <ToggleGroupItem value="ok">{t('okOnly')}</ToggleGroupItem>
                </ToggleGroup>
                <Input
                  type="number"
                  min={0}
                  aria-label={t('minDuration')}
                  placeholder={t('minDuration')}
                  className="dshx:h-8 dshx:w-36 dshx:font-mono!"
                  value={view.minDurationMs ?? ''}
                  onChange={event => update({ minDurationMs: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })}
                />
                {view.operation === null ? null : (
                  <Button variant="secondary" size="sm" onClick={() => update({ operation: null })}>
                    {t('operation')}: {view.operation} ✕
                  </Button>
                )}
                {filtered ? (
                  <Button variant="ghost" size="sm" onClick={() => update({ search: '', service: null, operation: null, status: 'all', minDurationMs: null })}>
                    {t('clearFilters')}
                  </Button>
                ) : null}
              </div>
              {listQuery.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage(listQuery.error, t('loadFailed'))}</AlertDescription>
                </Alert>
              ) : null}
              {traces.length === 0 && listQuery.isSuccess ? (
                <p className="dshx:text-sm dshx:text-muted-foreground">{filtered ? t('noMatch') : t('noTraces')}</p>
              ) : (
                <TraceList
                  traces={traces}
                  hasMore={listQuery.hasNextPage}
                  loadingMore={listQuery.isFetchingNextPage}
                  onLoadMore={() => void listQuery.fetchNextPage()}
                  onOpen={openedTraceId => update({ traceId: openedTraceId })}
                  t={t}
                />
              )}
            </>
          ) : (
            <>
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                <Button variant="ghost" size="sm" onClick={() => update({ traceId: null })}>
                  <ArrowLeftIcon /> {t('back')}
                </Button>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{traceId}</span>
                <Button variant="outline" size="sm" className="dshx:ml-auto" onClick={() => showLogs({ traceId, spanId: null })}>
                  <ScrollTextIcon /> <span className="dshx:@max-pane-narrow:sr-only">{t('logsForTrace')}</span>
                </Button>
              </div>
              {traceQuery.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{t('traceNotFound')}</AlertDescription>
                </Alert>
              ) : null}
              {traceQuery.data === undefined ? null : (
                <TraceDetailView
                  key={traceQuery.data.traceId}
                  trace={traceQuery.data}
                  onOpenThread={openThread}
                  onShowLogs={spanId => showLogs({ traceId: traceQuery.data.traceId, spanId })}
                  t={t}
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="logs">
          {view.tab === 'logs' ? (
            <LogsView
              client={client}
              services={services}
              correlation={logCorrelation}
              onClearCorrelation={() => setLogCorrelation(null)}
              onOpenTrace={openedTraceId => update({ traceId: openedTraceId, tab: 'traces' })}
              t={t}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="map">
          {mapQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mapQuery.error, t('loadFailed'))}</AlertDescription>
            </Alert>
          ) : null}
          {mapQuery.data === undefined ? null : (
            <ServiceMapView map={mapQuery.data} onPickService={service => update({ service, operation: null, tab: 'traces', traceId: null })} t={t} />
          )}
        </TabsContent>

        <TabsContent value="metrics">{view.tab === 'metrics' ? <MetricsView client={client} windowMinutes={view.windowMinutes} t={t} /> : null}</TabsContent>

        <TabsContent value="operations">
          {statsQuery.data === undefined ? null : (
            <div className="dshx:flex dshx:flex-col dshx:gap-4">
              <ModelCostTable models={statsQuery.data.models ?? []} t={t} />
              <OperationsTable stats={statsQuery.data} onPick={(service, operation) => update({ service, operation, tab: 'traces', traceId: null })} t={t} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="errors">
          {errorsQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(errorsQuery.error, t('loadFailed'))}</AlertDescription>
            </Alert>
          ) : null}
          {errorsQuery.data === undefined ? null : (
            <ErrorGroups groups={errorsQuery.data.groups} onOpenTrace={sampleTraceId => update({ traceId: sampleTraceId, tab: 'traces' })} t={t} />
          )}
        </TabsContent>

        <TabsContent value="boards">
          {view.tab === 'boards' ? (
            <BoardsView
              windowMinutes={view.windowMinutes}
              onDrillDown={drillDown =>
                update({
                  tab: 'traces',
                  traceId: null,
                  service: null,
                  ...('operation' in drillDown ? { operation: drillDown.operation, search: '' } : { operation: null, search: drillDown.search }),
                })
              }
              t={props.tAlerts}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="alerts">
          {view.tab === 'alerts' ? (
            <AlertsView onOpenTrace={openedTraceId => update({ traceId: openedTraceId, tab: 'traces' })} onOpenThread={openThread} t={props.tAlerts} />
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  )
}
