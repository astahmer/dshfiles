import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PageHeader } from '@dshfiles/plugin-ui/components/ui/page-header'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ArrowLeftIcon, CopyIcon, RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { type JSX, memo, useCallback, useMemo, useState } from 'react'
import { agentSessionsApi } from './api.js'
import { SessionFormat } from './format.js'
import { AgentLogs } from './parsers.js'
import type { AgentsviewKey, AgentsviewTranslate } from './locales.js'
import { type AgentKind, agentKindValues, type ItemKind, type SessionSummary, type TranscriptItem } from './types.js'

/** Request drafts keep optional filters unset instead of assigning `undefined`. */
interface ReadInput {
  readonly key: string
  readonly offset: number
  readonly limit: number
  kinds?: ItemKind[]
}
interface ListDraft {
  readonly limit: number
  agent?: AgentKind
  filter?: string
}
interface SearchDraft {
  readonly query: string
  agent?: AgentKind
}

const PAGE = 50
const TRANSCRIPT_PAGE = 100
const keys = {
  all: ['agentsview'] as const,
  sources: ['agentsview', 'sources'] as const,
  stats: ['agentsview', 'stats'] as const,
}

type AgentFilter = AgentKind | 'all'
const agentFilterOf = (value: string): AgentFilter | null => (value === 'all' ? 'all' : (agentKindValues.find(kind => kind === value) ?? null))

const KIND_KEY = {
  user: 'kindUser',
  assistant: 'kindAssistant',
  thinking: 'kindThinking',
  'tool-call': 'kindToolCall',
  'tool-result': 'kindToolResult',
  meta: 'kindMeta',
} as const satisfies Record<ItemKind, AgentsviewKey>

const AGE_KEY = {
  now: 'ageNow',
  minutes: 'ageMinutes',
  hours: 'ageHours',
  days: 'ageDays',
  months: 'ageMonths',
  years: 'ageYears',
} as const satisfies Record<ReturnType<typeof relativeTime>['unit'], AgentsviewKey>

const ageOf = (at: number, now: number, t: AgentsviewTranslate): string => {
  const age = relativeTime(at, now)
  return t(AGE_KEY[age.unit], { n: age.n })
}

const TokenLine = (props: { readonly session: SessionSummary; readonly t: AgentsviewTranslate }): JSX.Element => {
  const parts = SessionFormat.tokens(props.session.tokens)
  return (
    <span className="dshx:tabular-nums">
      {parts.input} {props.t('tokensIn')} · {parts.output} {props.t('tokensOut')} · {parts.cached} {props.t('tokensCached')}
    </span>
  )
}

interface SessionSelection {
  readonly key: string
  readonly startAt: number | null
}

const SessionRow = memo((props: {
  readonly session: SessionSummary
  readonly selected: boolean
  readonly snippet?: string | undefined
  readonly startAt?: number | null
  readonly now: number
  readonly t: AgentsviewTranslate
  readonly onOpen: (selection: SessionSelection) => void
}): JSX.Element => {
  const { session, t } = props
  return (
    <li>
      <button
        type="button"
        data-agent-session={session.key}
        aria-current={props.selected ? 'true' : undefined}
        onClick={() => props.onOpen({ key: session.key, startAt: props.startAt ?? null })}
        className={cn(
          'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-transparent dshx:px-3 dshx:py-2 dshx:text-left dshx:hover:bg-accent',
          props.selected && 'dshx:border-border dshx:bg-accent',
        )}
      >
        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <Badge variant="outline" className="dshx:shrink-0">
            {AgentLogs.label(session.agent)}
          </Badge>
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{session.title}</span>
          <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{ageOf(session.updatedAt, props.now, t)}</span>
        </span>
        {props.snippet === undefined ? null : <span className="dshx:line-clamp-2 dshx:text-xs dshx:text-foreground/80">{props.snippet}</span>}
        <span className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:gap-x-3 dshx:gap-y-0.5 dshx:text-xs dshx:text-muted-foreground">
          {session.cwd === null ? null : <span className="dshx:min-w-0 dshx:truncate dshx:font-mono!">{SessionFormat.shortPath(session.cwd)}</span>}
          <span className="dshx:tabular-nums">
            {session.userMessages === 1 ? t('promptCountOne') : t('promptCount', { count: session.userMessages })} ·{' '}
            {session.toolCalls === 1 ? t('toolCountOne') : t('toolCount', { count: session.toolCalls })}
          </span>
          <span className="dshx:@max-pane-narrow:hidden">
            <TokenLine session={session} t={t} />
          </span>
        </span>
      </button>
    </li>
  )
})

const ItemCard = (props: { readonly item: TranscriptItem; readonly t: AgentsviewTranslate }): JSX.Element => {
  const { item, t } = props
  const quiet = item.kind === 'thinking' || item.kind === 'meta' || item.kind === 'tool-result'
  return (
    <li
      data-transcript-item={item.index}
      data-kind={item.kind}
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2',
        item.kind === 'user' && 'dshx:bg-accent/60',
        quiet && 'dshx:bg-muted/30',
      )}
    >
      <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:font-medium dshx:text-foreground">{t(KIND_KEY[item.kind])}</span>
        {item.toolName === null ? null : <code className="dshx:font-mono!">{item.toolName}</code>}
        {item.isError ? <Badge variant="destructive">{t('error')}</Badge> : null}
        {item.truncated ? <span>({t('truncated')})</span> : null}
        <span className="dshx:ml-auto dshx:tabular-nums">#{item.index}</span>
      </span>
      {item.kind === 'tool-call' || item.kind === 'tool-result' ? (
        <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:break-words dshx:font-mono! dshx:text-xs">{item.text}</pre>
      ) : (
        <p className={cn('dshx:whitespace-pre-wrap dshx:break-words dshx:text-sm', quiet && 'dshx:text-muted-foreground')}>{item.text}</p>
      )}
    </li>
  )
}

const BASE_KINDS: readonly ItemKind[] = ['user', 'assistant']

const TranscriptView = (props: {
  readonly sessionKey: string
  readonly startAt: number | null
  readonly now: number
  readonly t: AgentsviewTranslate
  readonly onBack: () => void
}): JSX.Element => {
  const { t } = props
  const api = useApi(agentSessionsApi)
  const [showTools, setShowTools] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showMeta, setShowMeta] = useState(false)
  const [copied, setCopied] = useState(false)
  const kinds = useMemo(
    () => [
      ...BASE_KINDS,
      ...(showTools ? (['tool-call', 'tool-result'] as const) : []),
      ...(showThinking ? (['thinking'] as const) : []),
      ...(showMeta ? (['meta'] as const) : []),
    ],
    [showTools, showThinking, showMeta],
  )
  const [offset, setOffset] = useState(0)
  // A search hit names an absolute item index; it is only meaningful with every kind visible.
  const anchored = props.startAt !== null
  const effectiveKinds = anchored ? undefined : kinds
  const startOffset = anchored ? Math.max(0, (props.startAt ?? 0) - 5) : 0
  const transcript = useQuery({
    queryKey: ['agentsview', 'read', props.sessionKey, effectiveKinds ?? 'every', offset + startOffset],
    queryFn: async ({ signal }) => {
      const request: ReadInput = { key: props.sessionKey, offset: offset + startOffset, limit: TRANSCRIPT_PAGE }
      if (effectiveKinds !== undefined) request.kinds = [...effectiveKinds]
      return api.read(request, { signal })
    },
    placeholderData: previous => previous,
  })
  const data = transcript.data
  const session = data?.session
  const first = data === undefined ? 0 : data.offset
  const last = data === undefined ? 0 : data.offset + data.items.length

  return (
    <section aria-label={session?.title ?? t('loading')} className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        <Button variant="ghost" size="sm" className="dshx:shrink" onClick={props.onBack}>
          <ArrowLeftIcon aria-hidden /> <span className="dshx:@max-pane-narrow:sr-only">{t('back')}</span>
        </Button>
        <div className="dshx:min-w-0 dshx:flex-1">
          <h2 className="dshx:truncate dshx:text-base dshx:font-semibold">{session?.title ?? t('loading')}</h2>
          {session === undefined ? null : (
            <p className="dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:text-xs dshx:text-muted-foreground">
              <span>{AgentLogs.label(session.agent)}</span>
              {session.cwd === null ? null : <span className="dshx:min-w-0 dshx:truncate dshx:font-mono!">{session.cwd}</span>}
              {session.gitBranch === null ? null : <span className="dshx:font-mono!">{session.gitBranch}</span>}
              {session.models.length === 0 ? null : <span>{session.models.join(', ')}</span>}
              <TokenLine session={session} t={t} />
              <span>{ageOf(session.updatedAt, props.now, t)}</span>
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="dshx:shrink"
          onClick={() => {
            void writeClipboard(props.sessionKey).then(ok => setCopied(ok))
          }}
        >
          <CopyIcon aria-hidden /> <span className="dshx:@max-pane-compact:sr-only">{copied ? t('copied') : t('copyKey')}</span>
        </Button>
      </div>
      {anchored ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-2 dshx:text-xs">
          {(
            [
              ['showTools', showTools, setShowTools],
              ['showThinking', showThinking, setShowThinking],
              ['showMeta', showMeta, setShowMeta],
            ] as const
          ).map(([key, value, set]) => (
            <label key={key} className="dshx:flex dshx:items-center dshx:gap-2">
              <Switch
                checked={value}
                onCheckedChange={next => {
                  set(next)
                  setOffset(0)
                }}
              />
              {t(key)}
            </label>
          ))}
        </div>
      )}
      <p className="dshx:text-xs dshx:text-muted-foreground">{t('untrusted')}</p>
      {transcript.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(transcript.error, t('loadFailed'))}{' '}
            <Button variant="link" size="sm" onClick={() => void transcript.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {data === undefined ? (
        transcript.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <Spinner aria-hidden /> {t('loading')}
          </p>
        ) : null
      ) : (
        <>
          {data.capped ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('capped', { count: '20000' })}</p> : null}
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
            <span className="dshx:tabular-nums">{t('itemRange', { from: data.total === 0 ? 0 : first + 1, to: last, total: data.total })}</span>
            <Button variant="ghost" size="sm" disabled={first === 0} onClick={() => setOffset(current => Math.max(-startOffset, current - TRANSCRIPT_PAGE))}>
              {t('earlier')}
            </Button>
            <Button variant="ghost" size="sm" disabled={last >= data.total} onClick={() => setOffset(current => current + TRANSCRIPT_PAGE)}>
              {t('later')}
            </Button>
          </div>
          {data.items.length === 0 ? (
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('noItems')}</p>
          ) : (
            <ol className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-2 dshx:overflow-y-auto">
              {data.items.map(item => (
                <ItemCard key={item.index} item={item} t={t} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

export const AgentSessionsPanel = (props: { readonly t: AgentsviewTranslate }): JSX.Element => {
  const { t } = props
  const api = useApi(agentSessionsApi)
  const queryClient = useQueryClient()
  const [agent, setAgent] = useState<AgentFilter>('all')
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<SessionSelection | null>(null)
  const openSession = useCallback((selection: SessionSelection) => setSelected(selection), [])
  const filter = useDebouncedValue({ value: text.trim(), delayMs: 200 })

  const sources = useQuery({
    queryKey: keys.sources,
    queryFn: async ({ signal }) => api.sources({}, { signal }),
    refetchInterval: query => (query.state.data?.indexing.caughtUp === false ? 3_000 : 30_000),
  })
  const caughtUp = sources.data?.indexing.caughtUp ?? false
  const list = useQuery({
    queryKey: ['agentsview', 'list', agent, filter, limit, caughtUp],
    queryFn: async ({ signal }) => {
      const request: ListDraft = { limit }
      if (agent !== 'all') request.agent = agent
      if (filter.length > 0) request.filter = filter
      return api.list(request, { signal })
    },
    placeholderData: previous => previous,
    refetchInterval: caughtUp ? 30_000 : 5_000,
  })
  const stats = useQuery({ queryKey: [...keys.stats, caughtUp], queryFn: async ({ signal }) => api.stats({}, { signal }), refetchInterval: 60_000 })
  const search = useQuery({
    queryKey: ['agentsview', 'search', submitted, agent],
    queryFn: async ({ signal }) => {
      const request: SearchDraft = { query: submitted ?? '' }
      if (agent !== 'all') request.agent = agent
      return api.search(request, { signal })
    },
    enabled: submitted !== null && submitted.length >= 2,
  })
  const refresh = useMutation({
    mutationFn: async () => api.refresh({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.all }),
  })

  /** Ages are relative to the last answer, so render stays pure and rows agree with each other. */
  const now = Math.max(list.dataUpdatedAt, search.dataUpdatedAt)
  const indexing = sources.data?.indexing
  const noSources = sources.data !== undefined && sources.data.sources.every(source => !source.available)
  const searching = submitted !== null

  const listBody = (): JSX.Element => {
    if (searching) {
      if (search.isPending)
        return (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <Spinner aria-hidden /> {t('searchingMessages')}
          </p>
        )
      if (search.isError)
        return (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(search.error, t('loadFailed'))}</AlertDescription>
          </Alert>
        )
      const result = search.data
      return (
        <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-2">
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {t(result.complete ? 'searchComplete' : 'searchIncomplete', { scanned: result.scannedSessions, total: result.totalSessions })}{' '}
            <Button variant="link" size="sm" onClick={() => setSubmitted(null)}>
              {t('clearSearch')}
            </Button>
          </p>
          {result.hits.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noHits')}</p> : null}
          <ul className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto">
            {result.hits.map(hit => (
              <SessionRow
                key={`${hit.session.key}#${String(hit.itemIndex ?? 'title')}`}
                session={hit.session}
                snippet={hit.itemIndex === null ? `${t('matchInTitle')}: ${hit.snippet}` : `${t(KIND_KEY[hit.kind ?? 'user'])}: ${hit.snippet}`}
                selected={selected?.key === hit.session.key}
                startAt={hit.itemIndex}
                now={now}
                t={t}
                onOpen={openSession}
              />
            ))}
          </ul>
        </div>
      )
    }
    if (list.isPending)
      return (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
          <Spinner aria-hidden /> {t('loading')}
        </p>
      )
    if (list.isError)
      return (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(list.error, t('loadFailed'))}{' '}
            <Button variant="link" size="sm" onClick={() => void list.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )
    const rows = list.data.sessions
    return (
      <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-2">
        {rows.length === 0 && !noSources ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noSessions')}</p> : null}
        <ul aria-label={t('title')} className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto">
          {rows.map(session => (
            <SessionRow
              key={session.key}
              session={session}
              selected={selected?.key === session.key}
              now={now}
              t={t}
              onOpen={openSession}
            />
          ))}
        </ul>
        {rows.length < list.data.total ? (
          <Button
            variant="outline"
            size="sm"
            className="dshx:self-start"
            onClick={() => setLimit(current => Math.min(200, current + PAGE))}
            disabled={limit >= 200}
          >
            {t('showMore')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-hidden dshx:p-5 dshx:@max-pane-narrow:p-3">
      <PageHeader heading={t('title')} description={t('subtitle')}>
        {list.data === undefined ? null : <Badge variant="outline">{t('sessionsCount', { count: list.data.total })}</Badge>}
        <Button variant="outline" size="sm" className="dshx:shrink" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <Spinner aria-hidden /> : <RefreshCwIcon aria-hidden />} <span className="dshx:@max-pane-narrow:sr-only">{t('refresh')}</span>
        </Button>
      </PageHeader>

      {noSources ? (
        <Alert>
          <AlertDescription>{t('noSources')}</AlertDescription>
        </Alert>
      ) : null}
      {indexing !== undefined && !indexing.caughtUp ? (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" role="status">
          <Spinner aria-hidden /> {t('indexing', { indexed: indexing.indexedFiles, total: indexing.totalFiles })}
        </p>
      ) : null}
      {indexing?.lastError == null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{t('indexError', { error: indexing.lastError })}</AlertDescription>
        </Alert>
      )}

      {stats.data === undefined || stats.data.byAgent.length === 0 ? null : (
        <div aria-label={t('statsWindow')} className="dshx:flex dshx:flex-wrap dshx:gap-2 dshx:@max-pane-narrow:hidden">
          {stats.data.byAgent.map(row => {
            const parts = SessionFormat.tokens(row.tokens)
            return (
              <div
                key={row.name}
                className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2 dshx:text-xs"
              >
                <span className="dshx:font-medium">
                  {row.name} · {t('statsWindow')}
                </span>
                <span className="dshx:text-muted-foreground dshx:tabular-nums">
                  {SessionFormat.count(row.sessions)} {t('statsSessions')} · {SessionFormat.count(row.userMessages)} {t('prompts')} · {parts.input}{' '}
                  {t('tokensIn')} · {parts.output} {t('tokensOut')}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:items-stretch">
        <ToggleGroup
          aria-label={t('agentFilter')}
          size="sm"
          type="single"
          value={agent}
          onValueChange={next => {
            const chosen = agentFilterOf(next)
            if (chosen === null) return
            setAgent(chosen)
            setLimit(PAGE)
          }}
        >
          <ToggleGroupItem value="all">{t('allAgents')}</ToggleGroupItem>
          {agentKindValues.map(kind => (
            <ToggleGroupItem key={kind} value={kind}>
              {AgentLogs.label(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <form
          className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2"
          onSubmit={event => {
            event.preventDefault()
            const query = text.trim()
            setSubmitted(query.length >= 2 ? query : null)
          }}
        >
          <SearchInput
            className="dshx:min-w-56 dshx:flex-1 dshx:@max-pane-compact:min-w-0"
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={text}
            onChange={event => {
              setText(event.currentTarget.value)
              setLimit(PAGE)
            }}
          />
          <Button type="submit" variant="outline" size="sm" className="dshx:shrink" disabled={text.trim().length < 2}>
            <SearchIcon aria-hidden /> <span className="dshx:@max-pane-compact:sr-only">{t('searchMessages')}</span>
          </Button>
        </form>
      </div>

      <div className="dshx:grid dshx:min-h-0 dshx:flex-1 dshx:grid-cols-[minmax(18rem,2fr)_3fr] dshx:gap-4 dshx:@max-pane-compact:grid-cols-1">
        <div className={cn('dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col', selected !== null && 'dshx:@max-pane-compact:hidden')}>{listBody()}</div>
        {selected === null ? (
          <p className="dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-compact:hidden">{t('selectSession')}</p>
        ) : (
          <TranscriptView
            key={`${selected.key}#${String(selected.startAt)}`}
            sessionKey={selected.key}
            startAt={selected.startAt}
            now={now}
            t={t}
            onBack={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}
