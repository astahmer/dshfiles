import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useLoadMore } from '@dshfiles/plugin-ui/hooks/use-load-more'
import { usePrependScrollAnchor } from '@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import type { ActivityEvent, ActivityLevel, ActivitySource, CondensedItem } from './types.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { activityTimelineApi } from './api.js'
import { createFeedHistory, mergeFeedItems } from './feed-history.js'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import type { ActivityTimelineTranslate } from './locales.js'

const feedKey = ['activity-timeline', 'feed'] as const
const statsKey = ['activity-timeline', 'stats'] as const

const badgeVariant = (item: CondensedItem): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (item.level === 'attention') return 'destructive'
  if (item.source === 'integration') return 'default'
  if (item.source === 'communication') return 'secondary'
  return 'outline'
}

/**
 * A clock alone is ambiguous the moment a timeline spans more than one day:
 * `00:41:29` reads as today even when it is last week. Today keeps the clock;
 * anything older carries its date, so ordering stays legible at a glance.
 */
const formatTime = (at: number, now: number = Date.now()): string => {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${time}`
}

/** The unambiguous spelling, for a hover or an event detail. */
const formatExact = (at: number): string => new Date(at).toLocaleString()

const levelMarker = (level: CondensedItem['level']): string =>
  level === 'attention' ? 'dshx:bg-destructive' : level === 'notable' ? 'dshx:bg-primary' : 'dshx:bg-muted-foreground/40'

const ActivityRow = (props: {
  readonly item: CondensedItem
  readonly selected: boolean
  readonly t: ActivityTimelineTranslate
  readonly sessionLabel: (sessionId: string) => string
  readonly onSelect: (item: CondensedItem) => void
}): JSX.Element => (
  <button
    type="button"
    onClick={() => props.onSelect(props.item)}
    className={`dshx:flex dshx:w-full dshx:items-start dshx:gap-3 dshx:rounded-md dshx:border dshx:px-3 dshx:py-2 dshx:text-left ${props.selected ? 'dshx:border-primary dshx:bg-accent/40' : 'dshx:border-transparent dshx:hover:bg-accent/30'}`}
  >
    <span className={`dshx:mt-1.5 dshx:h-2 dshx:w-2 dshx:shrink-0 dshx:rounded-full ${levelMarker(props.item.level)}`} aria-hidden />
    <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
      <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Badge variant={badgeVariant(props.item)}>{props.t(props.item.source)}</Badge>
        <span className="dshx:break-words dshx:text-sm">{props.item.summary}</span>
        {props.item.count > 1 ? <Badge variant="outline">{props.item.count}×</Badge> : null}
      </span>
      <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
        <span title={formatExact(props.item.at)}>{formatTime(props.item.at)}</span>
        {props.item.sessionId === null ? null : <span className="dshx:truncate">{props.sessionLabel(props.item.sessionId)}</span>}
        {props.item.correlationId === null ? null : <span>correlation {props.item.correlationId}</span>}
      </span>
    </span>
  </button>
)

export const ActivityTimelinePanel = (props: {
  readonly sessions: ISessions
  readonly uiWorkspace: UiWorkspace
  readonly workspaces: IWorkspaces
  readonly t: ActivityTimelineTranslate
}): JSX.Element => {
  const api = useApi(activityTimelineApi)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const t = props.t
  const [search, setSearch] = useState('')
  const [sources, setSources] = useState<readonly ActivitySource[]>([])
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [detailed, setDetailed] = useState(false)
  const [older, setOlder] = useState<readonly CondensedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const feedHistory = useMemo(() => createFeedHistory(), [])
  const mergedItems = useRef<readonly CondensedItem[]>([])
  const [selected, setSelected] = useState<CondensedItem | null>(null)
  const [pendingNew, setPendingNew] = useState(0)
  const [navigationError, setNavigationError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const debouncedSearch = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const attentionLevels: readonly ActivityLevel[] = ['attention']
  const filterKey = useMemo(
    () => [debouncedSearch, [...sources].sort().join(','), attentionOnly, detailed] as const,
    [debouncedSearch, sources, attentionOnly, detailed],
  )
  const olderScope = JSON.stringify(filterKey)
  const captureOlderAnchor = usePrependScrollAnchor({ root: scrollRef, pageCount: older.length, scope: olderScope })
  const feedQuery = useQuery({
    queryKey: [...feedKey, ...filterKey],
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        request: hostSignal =>
          api.page(
            {
              ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
              ...(sources.length === 0 ? {} : { sources: [...sources] }),
              ...(attentionOnly ? { levels: [...attentionLevels] } : {}),
              detailed,
              limit: 80,
            },
            { signal: hostSignal },
          ),
      }),
    refetchInterval: 5_000,
    retry: 1,
  })
  const statsQuery = useQuery({
    queryKey: statsKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.stats({}, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 1,
  })
  const olderMutation = useMutation({
    mutationFn: async (_token: number) => {
      if (cursor === null) return null
      return runHostRequest({
        request: signal =>
          api.page(
            {
              cursor,
              ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
              ...(sources.length === 0 ? {} : { sources: [...sources] }),
              ...(attentionOnly ? { levels: [...attentionLevels] } : {}),
              detailed,
              limit: 80,
            },
            { signal },
          ),
      })
    },
    onSuccess: (page, token) => {
      // A page that resolved after the filter changed belongs to the previous history.
      if (page === null || !feedHistory.accepts(token)) return
      const pageItems = page.items ?? []
      setOlder(current => [...pageItems, ...current])
      setCursor(page.nextCursor)
    },
  })
  const loadOlder = (): void => {
    if (cursor === null || olderMutation.isPending) return
    captureOlderAnchor()
    olderMutation.mutate(feedHistory.request())
  }
  const olderSentinel = useLoadMore({
    enabled: cursor !== null && !olderMutation.isPending && !olderMutation.isError,
    resetKey: older.length,
    onLoadMore: loadOlder,
    root: scrollRef,
    rootMargin: '500px 0px 0px 0px',
  })
  const detailQuery = useQuery({
    queryKey: ['activity-timeline', 'event', selected?.id],
    enabled: selected !== null && selected.kind === 'event',
    queryFn: ({ signal }) => {
      const eventId = selected?.eventIds[0]
      if (eventId === undefined) throw new Error('Select an event first.')
      return runHostRequest({ signal, request: hostSignal => api.event({ eventId }, { signal: hostSignal }) })
    },
    retry: false,
  })
  const relatedQuery = useQuery({
    queryKey: ['activity-timeline', 'related', selected?.id],
    enabled: selected !== null && selected.kind === 'event',
    queryFn: ({ signal }) => {
      const eventId = selected?.eventIds[0]
      if (eventId === undefined) throw new Error('Select an event first.')
      return runHostRequest({ signal, request: hostSignal => api.related({ eventId }, { signal: hostSignal }) })
    },
    retry: false,
  })
  const newestItems = feedQuery.data?.items ?? []
  const items = useMemo(() => {
    const merged = mergeFeedItems({ older, newest: newestItems, previous: mergedItems.current })
    mergedItems.current = merged
    return merged
  }, [older, newestItems])
  const newestId = items.length === 0 ? null : (items[items.length - 1]?.id ?? null)

  useEffect(() => {
    setNavigationError('')
  }, [selected?.id])

  const resetOlderMutation = olderMutation.reset
  useEffect(() => {
    feedHistory.invalidate()
    mergedItems.current = []
    setOlder([])
    setCursor(null)
    resetOlderMutation()
  }, [feedHistory, filterKey, resetOlderMutation])

  useEffect(() => {
    if (older.length === 0) setCursor(feedQuery.data?.nextCursor ?? null)
  }, [feedQuery.data?.nextCursor, older.length])

  useEffect(() => {
    const container = scrollRef.current
    if (container === null) return
    if (nearBottomRef.current) container.scrollTop = container.scrollHeight
    else setPendingNew(count => count + 1)
  }, [newestId])

  const toggleSource = (source: ActivitySource): void =>
    setSources(current => (current.includes(source) ? current.filter(item => item !== source) : [...current, source]))
  const jumpToLatest = (): void => {
    const container = scrollRef.current
    if (container !== null) container.scrollTop = container.scrollHeight
    nearBottomRef.current = true
    setPendingNew(0)
  }
  const selectedEvent: ActivityEvent | undefined = detailQuery.data
  const openOwningSession = (sessionId: string): void => {
    const workspaceList = props.workspaces.list.getSnapshot()
    if (workspaceList.phase !== 'ready' || workspaceList.archivedSessionIds.some(archivedId => archivedId === sessionId)) {
      setNavigationError(t('sessionUnavailable'))
      return
    }
    const sessionList = props.sessions.list.getSnapshot()
    const availableId = sessionList.ids.find(candidate => candidate === sessionId)
    const session = availableId === undefined ? undefined : sessionList.byId[availableId]
    if (session === undefined) {
      setNavigationError(t('sessionUnavailable'))
      return
    }
    try {
      props.uiWorkspace.openSession(session.id)
      setNavigationError('')
    } catch {
      setNavigationError(t('sessionNavigationFailed'))
    }
  }
  const openEventSession = (event: ActivityEvent): void => {
    if (event.sessionId === null) return
    openOwningSession(event.sessionId)
  }

  return (
    <div className="dshx-root dshx:@container">
      <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:p-5 dshx:@max-pane-narrow:p-3">
        <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
          <div>
            <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
            <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <Badge variant="secondary">
              {statsQuery.data?.retained ?? 0} {t('retained')}
            </Badge>
            <Badge variant={statsQuery.data !== undefined && statsQuery.data.attention > 0 ? 'destructive' : 'outline'}>
              {statsQuery.data?.attention ?? 0} {t('attention')}
            </Badge>
            <Badge variant="outline">
              {statsQuery.data?.duplicates ?? 0} {t('duplicates')}
            </Badge>
            <Button variant="outline" size="sm" disabled={feedQuery.isFetching} onClick={() => void feedQuery.refetch()}>
              <RefreshCwIcon aria-hidden /> {t('refresh')}
            </Button>
          </div>
        </header>
        {/* Below the compact tier the search takes its own line and the filters scroll sideways instead of wrapping. */}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:items-stretch">
          <InputGroup className="dshx:min-w-56 dshx:flex-1 dshx:@max-pane-compact:min-w-0">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('search')}
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
            />
          </InputGroup>
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:@max-pane-compact:overflow-x-auto dshx:@max-pane-compact:pb-1">
            {(['session', 'communication', 'integration'] as const).map(source => (
              <Button
                key={source}
                size="sm"
                variant={sources.includes(source) ? 'secondary' : 'outline'}
                aria-pressed={sources.includes(source)}
                onClick={() => toggleSource(source)}
              >
                {t(source)}
              </Button>
            ))}
            <Button
              size="sm"
              variant={attentionOnly ? 'destructive' : 'outline'}
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly(value => !value)}
            >
              {t('attentionOnly')}
            </Button>
            <Button size="sm" variant={detailed ? 'secondary' : 'outline'} aria-pressed={detailed} onClick={() => setDetailed(value => !value)}>
              {t('detailed')}
            </Button>
          </div>
        </div>
        {feedQuery.error === null && olderMutation.error === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(feedQuery.error ?? olderMutation.error, t('loadFailed'))}</AlertDescription>
          </Alert>
        )}
        <div className="dshx:grid dshx:min-h-0 dshx:gap-3 dshx:@4xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="dshx:min-w-0">
            <CardHeader className="dshx:flex dshx:flex-row dshx:items-center dshx:justify-between dshx:gap-2 dshx:pb-2">
              <CardTitle className="dshx:text-sm">{t('title')}</CardTitle>
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                {pendingNew > 0 ? (
                  <Button size="sm" variant="secondary" onClick={jumpToLatest}>
                    {t('newEvents')} ({pendingNew})
                  </Button>
                ) : null}
                {cursor === null || !olderMutation.isError ? null : (
                  <Button size="sm" variant="outline" onClick={loadOlder}>
                    {t('loadOlder')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="dshx:p-2">
              <div
                ref={scrollRef}
                onScroll={event => {
                  const target = event.currentTarget
                  nearBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80
                  if (nearBottomRef.current) setPendingNew(0)
                }}
                className="dshx:flex dshx:h-[62vh] dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:pr-1"
              >
                {items.length === 0 && !feedQuery.isPending ? (
                  <p className="dshx:p-3 dshx:text-sm dshx:text-muted-foreground">
                    {debouncedSearch.length === 0 && sources.length === 0 && !attentionOnly ? t('noActivity') : t('noMatch')}
                  </p>
                ) : null}
                <div key="activity-older-sentinel" ref={olderSentinel} aria-hidden="true" style={{ flex: '0 0 1px', height: 1 }} />
                {items.map(item => (
                  <ActivityRow key={item.id} item={item} selected={selected?.id === item.id} t={t} sessionLabel={sessionLabel} onSelect={setSelected} />
                ))}
              </div>
              {olderMutation.isPending ? (
                <p className="dshx:p-1 dshx:text-xs dshx:text-muted-foreground" role="status">
                  {t('loadingOlder')}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="dshx:min-w-0">
            <CardHeader className="dshx:pb-2">
              <CardTitle className="dshx:text-sm">{t('detail')}</CardTitle>
            </CardHeader>
            <CardContent className="dshx:flex dshx:max-h-[62vh] dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:text-sm">
              {selected === null ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('emptyDetail')}</p> : null}
              {selected !== null && selected.kind === 'group' ? (
                <>
                  <p className="dshx:text-sm dshx:font-medium">{selected.summary}</p>
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    {t('groupMembers')}: {selected.eventIds.length} {t('events')}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setDetailed(true)}>
                    {t('detailed')}
                  </Button>
                </>
              ) : null}
              {selectedEvent === undefined ? null : (
                <>
                  <p className="dshx:break-words dshx:text-sm dshx:font-medium">{selectedEvent.summary}</p>
                  <p className="dshx:text-xs dshx:text-muted-foreground" title={formatExact(selectedEvent.at)}>
                    {selectedEvent.type} · {formatTime(selectedEvent.at)} · {formatExact(selectedEvent.at)}
                  </p>
                  {selectedEvent.detail === null ? null : <p className="dshx:break-words dshx:text-xs">{selectedEvent.detail}</p>}
                  {selectedEvent.sessionId === null ? null : (
                    <Button size="sm" variant="outline" onClick={() => openEventSession(selectedEvent)}>
                      {t('openSession')}
                    </Button>
                  )}
                  {navigationError.length === 0 ? null : (
                    <Alert variant="destructive">
                      <AlertDescription>{navigationError}</AlertDescription>
                    </Alert>
                  )}
                  <Separator />
                  <p className="dshx:text-xs dshx:font-semibold">{t('metadata')}</p>
                  <pre className="dshx:overflow-x-auto dshx:rounded dshx:bg-muted/60 dshx:p-2 dshx:text-[11px]">
                    {JSON.stringify(selectedEvent.metadata, null, 2)}
                  </pre>
                  <p className="dshx:text-xs dshx:font-semibold">{t('references')}</p>
                  <div className="dshx:flex dshx:flex-wrap dshx:gap-1">
                    {selectedEvent.references.map(reference => (
                      <Badge key={`${reference.kind}:${reference.id}`} variant="outline">
                        {reference.kind}: {reference.kind === 'session' ? sessionLabel(reference.id) : reference.id.slice(0, 12)}
                      </Badge>
                    ))}
                    {selectedEvent.references.length === 0 ? <span className="dshx:text-xs dshx:text-muted-foreground">—</span> : null}
                  </div>
                  <p className="dshx:text-xs dshx:font-semibold">{t('related')}</p>
                  {(relatedQuery.data?.events ?? []).length < 2 ? (
                    <p className="dshx:text-xs dshx:text-muted-foreground">—</p>
                  ) : (
                    <div className="dshx:flex dshx:flex-col dshx:gap-1">
                      {(relatedQuery.data?.events ?? []).slice(0, 20).map(event => (
                        <span key={event.id} className="dshx:text-xs" title={formatExact(event.at)}>
                          {formatTime(event.at)} · {event.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    {t('provenance')}: {t(selectedEvent.provenance)}
                  </p>
                </>
              )}
              <p className="dshx:mt-auto dshx:text-[11px] dshx:text-muted-foreground">{t('routineHidden')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
