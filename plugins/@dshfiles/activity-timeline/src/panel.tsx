import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { ActivityFeed, type ActivityActor, type ActivityFeedEvent } from '@dshfiles/plugin-ui/components/motion/activity-feed'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useLoadMore } from '@dshfiles/plugin-ui/hooks/use-load-more'
import { usePrependScrollAnchor } from '@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { errorMessage, useInfiniteQuery, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import type { ActivityEvent, ActivitySource, CondensedItem } from './types.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activityTimelineApi } from './api.js'
import { activityFeedKeys, activityFeedQueries, NO_PAGES, type ActivityFeedFilter } from './feed-queries.js'
import { mergeFeedItems } from './feed-history.js'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import type { ActivityTimelineTranslate } from './locales.js'

const statsKey = ['activity-timeline', 'stats'] as const

/** How many rows one page carries; the tail page polls and the older pages load on demand. */
const FEED_PAGE_LIMIT = 80

/** Dark cockpit: only attention gets colour; the source stays a neutral chip. */
const badgeVariant = (item: CondensedItem): 'outline' | 'destructive' => (item.level === 'attention' ? 'destructive' : 'outline')

const SOURCE_INITIALS = { session: 'AG', communication: 'CO', integration: 'JJ', workspace: 'WS', system: 'SY' } as const satisfies Record<
  ActivitySource,
  string
>

const formatDay = (at: number): string => new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const formatClock = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * A clock alone is ambiguous the moment a timeline spans more than one day:
 * `00:41:29` reads as today even when it is last week. Today keeps the clock;
 * anything older carries its date, so ordering stays legible at a glance.
 */
const formatTime = (at: number, now: number = Date.now()): string => {
  const date = new Date(at)
  const time = formatClock(at)
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${formatDay(at)} ${time}`
}

/** The unambiguous spelling, for a hover or an event detail. */
const formatExact = (at: number): string => new Date(at).toLocaleString()

/** Rows group under their day, so each row keeps only its clock; attention is the one actor tile with colour. */
const feedEvent = (props: {
  readonly item: CondensedItem
  readonly selected: boolean
  readonly t: ActivityTimelineTranslate
  readonly sessionLabel: (sessionId: string) => string
  readonly today: string
}): ActivityFeedEvent => {
  const item = props.item
  const actor: ActivityActor = {
    name: props.t(item.source),
    initials: SOURCE_INITIALS[item.source],
    tone: item.level === 'attention' ? 'destructive' : 'muted',
  }
  const day = formatDay(item.at)
  return {
    id: item.id,
    actor,
    summary: item.summary,
    time: formatClock(item.at),
    dateTime: new Date(item.at).toISOString(),
    group: day === props.today ? props.t('today') : day,
    selected: props.selected,
    meta: (
      <>
        <Badge variant={badgeVariant(item)}>{props.t(item.source)}</Badge> {item.count > 1 ? <Badge variant="outline">{item.count}×</Badge> : null}{' '}
        {item.sessionId === null ? null : <span className="dshx:min-w-0 dshx:truncate">{props.sessionLabel(item.sessionId)}</span>}{' '}
        {item.correlationId === null ? null : <span className="dshx:truncate">correlation {item.correlationId}</span>}
      </>
    ),
  }
}

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
  const [failedPageScope, setFailedPageScope] = useState<string | null>(null)
  const mergedItems = useRef<readonly CondensedItem[]>([])
  const [selected, setSelected] = useState<CondensedItem | null>(null)
  const [pendingNew, setPendingNew] = useState(0)
  const [navigationError, setNavigationError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const debouncedSearch = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const filter = useMemo<ActivityFeedFilter>(
    () => ({ search: debouncedSearch, sources, attentionOnly, detailed }),
    [debouncedSearch, sources, attentionOnly, detailed],
  )
  const filterKey = useMemo(() => activityFeedKeys.filter(filter), [filter])
  const olderScope = JSON.stringify(filterKey)
  const feedQuery = useInfiniteQuery(activityFeedQueries.feed({ client: api, filter, limit: FEED_PAGE_LIMIT }))
  const pages = feedQuery.data?.pages
  const { newest: newestItems, older } = useMemo(() => activityFeedQueries.items(pages ?? NO_PAGES), [pages])
  const captureOlderAnchor = usePrependScrollAnchor({ root: scrollRef, pageCount: older.length, scope: olderScope })
  const olderPageFailed = failedPageScope === olderScope
  const loadOlder = (): void => {
    if (feedQuery.hasNextPage !== true || feedQuery.isFetchingNextPage) return
    captureOlderAnchor()
    setFailedPageScope(null)
    void feedQuery.fetchNextPage()
  }
  const olderSentinel = useLoadMore({
    enabled: feedQuery.hasNextPage === true && !feedQuery.isFetchingNextPage && !olderPageFailed,
    resetKey: older.length,
    onLoadMore: loadOlder,
    root: scrollRef,
    rootMargin: '500px 0px 0px 0px',
  })
  const statsQuery = useQuery({
    queryKey: statsKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.stats({}, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 1,
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
  const items = useMemo(() => {
    const merged = mergeFeedItems({ older, newest: newestItems, previous: mergedItems.current })
    mergedItems.current = merged
    return merged
  }, [older, newestItems])
  const newestId = items.length === 0 ? null : (items[items.length - 1]?.id ?? null)
  const today = formatDay(feedQuery.dataUpdatedAt)
  const feedEvents = useMemo(
    () => items.map(item => feedEvent({ item, selected: selected?.id === item.id, t, sessionLabel, today })),
    [items, selected?.id, t, sessionLabel, today],
  )
  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const selectFeedEvent = useCallback((event: ActivityFeedEvent) => setSelected(itemsById.get(event.id) ?? null), [itemsById])

  useEffect(() => {
    setNavigationError('')
  }, [selected?.id])

  useEffect(() => {
    if (feedQuery.isFetchNextPageError) setFailedPageScope(olderScope)
  }, [feedQuery.isFetchNextPageError, olderScope])

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
    <Page
      heading={t('title')}
      description={t('subtitle')}
      meta={
        <>
          <Badge variant="muted">
            {statsQuery.data?.retained ?? 0} {t('retained')}
          </Badge>
          <Badge variant={statsQuery.data !== undefined && statsQuery.data.attention > 0 ? 'destructive' : 'muted'}>
            {statsQuery.data?.attention ?? 0} {t('attention')}
          </Badge>
          <Badge variant="muted">
            {statsQuery.data?.duplicates ?? 0} {t('duplicates')}
          </Badge>
        </>
      }
      actions={[
        { id: 'refresh', label: t('refresh'), icon: <RefreshCwIcon aria-hidden />, disabled: feedQuery.isFetching, onSelect: () => void feedQuery.refetch() },
      ]}
    >
      {/* Below the compact tier the search takes its own line and the filters scroll sideways instead of wrapping. */}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:items-stretch">
        <SearchInput
          className="dshx:min-w-56 dshx:flex-1 dshx:@max-pane-compact:min-w-0"
          aria-label={t('search')}
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
        <div className="dshx:flex dshx:min-w-0 dshx:max-w-full dshx:items-center dshx:gap-2 dshx:@max-pane-compact:overflow-x-auto dshx:@max-pane-compact:pb-1">
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
          <Button size="sm" variant={attentionOnly ? 'destructive' : 'outline'} aria-pressed={attentionOnly} onClick={() => setAttentionOnly(value => !value)}>
            {t('attentionOnly')}
          </Button>
          <Button size="sm" variant={detailed ? 'secondary' : 'outline'} aria-pressed={detailed} onClick={() => setDetailed(value => !value)}>
            {t('detailed')}
          </Button>
        </div>
      </div>
      {feedQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(feedQuery.error, t('loadFailed'))}</AlertDescription>
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
              {!olderPageFailed ? null : (
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
                <EmptyState>{debouncedSearch.length === 0 && sources.length === 0 && !attentionOnly ? t('noActivity') : t('noMatch')}</EmptyState>
              ) : null}
              <div key="activity-older-sentinel" ref={olderSentinel} aria-hidden="true" style={{ flex: '0 0 1px', height: 1 }} />
              <ActivityFeed events={feedEvents} emptyLabel={null} onSelectEvent={selectFeedEvent} />
            </div>
            {feedQuery.isFetchingNextPage ? (
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
            {selected === null ? <EmptyState>{t('emptyDetail')}</EmptyState> : null}
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
                <pre className="dshx:overflow-x-auto dshx:rounded dshx:bg-muted/60 dshx:p-2 dshx:text-xs">
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
            <p className="dshx:mt-auto dshx:text-xs dshx:text-muted-foreground">{t('routineHidden')}</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
