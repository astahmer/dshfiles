import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import type { ActivityEvent, ActivityLevel, ActivitySource, CondensedItem } from './types.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { activityTimelineApi } from './api.js'
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
  readonly onSelect: (item: CondensedItem) => void
}): JSX.Element => (
  <button
    type="button"
    onClick={() => props.onSelect(props.item)}
    className={`dshx:flex dshx:w-full dshx:items-start dshx:gap-3 dshx:rounded-md dshx:border dshx:px-3 dshx:py-2 dshx:text-left ${props.selected ? 'dshx:border-primary dshx:bg-accent/40' : 'dshx:border-transparent hover:dshx:bg-accent/30'}`}
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
        {props.item.sessionId === null ? null : <span>session {props.item.sessionId.slice(0, 8)}</span>}
        {props.item.correlationId === null ? null : <span>correlation {props.item.correlationId}</span>}
      </span>
    </span>
  </button>
)

export const ActivityTimelinePanel = (props: { readonly t: ActivityTimelineTranslate }): JSX.Element => {
  const api = useApi(activityTimelineApi)
  const t = props.t
  const [search, setSearch] = useState('')
  const [sources, setSources] = useState<readonly ActivitySource[]>([])
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [detailed, setDetailed] = useState(false)
  const [older, setOlder] = useState<readonly CondensedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<CondensedItem | null>(null)
  const [pendingNew, setPendingNew] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const debouncedSearch = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const attentionLevels: readonly ActivityLevel[] = ['attention']
  const filterKey = useMemo(
    () => [debouncedSearch, [...sources].sort().join(','), attentionOnly, detailed] as const,
    [debouncedSearch, sources, attentionOnly, detailed],
  )
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
    mutationFn: async () => {
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
    onSuccess: page => {
      if (page === null) return
      setOlder(current => [...(page.items ?? []), ...current])
      setCursor(page.nextCursor)
    },
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
    const seen = new Set<string>()
    const merged: CondensedItem[] = []
    for (const item of [...older, ...newestItems]) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
    return merged.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
  }, [older, newestItems])
  const newestId = items.length === 0 ? null : (items[items.length - 1]?.id ?? null)

  useEffect(() => {
    setOlder([])
    setCursor(null)
  }, [filterKey])

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

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-3 dshx:p-3 dshx:sm:p-5">
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
          <Button variant="outline" size="sm" disabled={feedQuery.isFetching} onClick={() => void feedQuery.refetch()}>
            <RefreshCwIcon aria-hidden /> {t('refresh')}
          </Button>
        </div>
      </header>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <div className="dshx:relative dshx:min-w-56 dshx:flex-1">
          <SearchIcon
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:left-2.5 dshx:top-1/2 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
          />
          <Input
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={event => setSearch(event.currentTarget.value)}
            className="dshx:pl-8"
          />
        </div>
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
      {feedQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(feedQuery.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      )}
      <div className="dshx:grid dshx:min-h-0 dshx:gap-3 dshx:xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="dshx:min-w-0">
          <CardHeader className="dshx:flex dshx:flex-row dshx:items-center dshx:justify-between dshx:gap-2 dshx:pb-2">
            <CardTitle className="dshx:text-sm">{t('title')}</CardTitle>
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              {pendingNew > 0 ? (
                <Button size="sm" variant="secondary" onClick={jumpToLatest}>
                  {t('newEvents')} ({pendingNew})
                </Button>
              ) : null}
              {cursor === null ? null : (
                <Button size="sm" variant="outline" disabled={olderMutation.isPending} onClick={() => olderMutation.mutate()}>
                  {olderMutation.isPending ? t('loadingOlder') : t('loadOlder')}
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
              {items.map(item => (
                <ActivityRow key={item.id} item={item} selected={selected?.id === item.id} t={t} onSelect={setSelected} />
              ))}
            </div>
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
                <Separator />
                <p className="dshx:text-xs dshx:font-semibold">{t('metadata')}</p>
                <pre className="dshx:overflow-x-auto dshx:rounded dshx:bg-muted/60 dshx:p-2 dshx:text-[11px]">
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
                <p className="dshx:text-xs dshx:font-semibold">{t('references')}</p>
                <div className="dshx:flex dshx:flex-wrap dshx:gap-1">
                  {selectedEvent.references.map(reference => (
                    <Badge key={`${reference.kind}:${reference.id}`} variant="outline">
                      {reference.kind}: {reference.id.slice(0, 12)}
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
  )
}
