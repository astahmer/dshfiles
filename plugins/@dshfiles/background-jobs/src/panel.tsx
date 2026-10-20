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
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { ChevronDownIcon, ChevronRightIcon, RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type { ISessions, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backgroundJobsApi } from './api.js'
import { jobCategoryValues, type JobCategory } from './classify.js'
import { JobSelectionModel } from './job-selection.js'
import type { BackgroundJobsKey, BackgroundJobsTranslate } from './locales.js'
import type { JobBoard, JobRow, JobScope, JobStatus } from './types.js'

const boardKey = ['background-jobs', 'board'] as const

/** The query draft keeps optional filters unset instead of assigning `undefined`. */
interface BoardQueryDraft {
  readonly scope: JobScope
  readonly limit: number
  categories?: JobCategory[]
  search?: string
}
const POLL_LIVE_MS = 5_000
const POLL_IDLE_MS = 15_000
const PAGE_LIMIT = 200

const CATEGORY_KEY = {
  tests: 'categoryTests',
  typecheck: 'categoryTypecheck',
  'lint-format': 'categoryLintFormat',
  build: 'categoryBuild',
  'install-deps': 'categoryInstallDeps',
  vcs: 'categoryVcs',
  inspect: 'categoryInspect',
  scripts: 'categoryScripts',
  process: 'categoryProcess',
  files: 'categoryFiles',
  dsh: 'categoryDsh',
  workflow: 'categoryWorkflow',
  terminal: 'categoryTerminal',
  other: 'categoryOther',
} as const satisfies Record<JobCategory, BackgroundJobsKey>

const STATUS_KEY = {
  running: 'statusRunning',
  stopping: 'statusStopping',
  completed: 'statusCompleted',
  killed: 'statusKilled',
  failed: 'statusFailed',
  interrupted: 'statusInterrupted',
} as const satisfies Record<JobStatus, BackgroundJobsKey>

const isLiveStatus = (status: JobStatus): boolean => status === 'running' || status === 'stopping'

const durationLabel = (row: JobRow, now: number): string => {
  if (row.finishedAt === null && !isLiveStatus(row.status)) return '—'
  const seconds = Math.max(0, Math.round(((row.finishedAt ?? now) - row.startedAt) / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
}

/** A clock alone is ambiguous across days, so anything older than today carries its date. */
const formatStarted = (at: number, now: number): string => {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

const statusVariant = (status: JobStatus): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'failed') return 'destructive'
  if (isLiveStatus(status)) return 'secondary'
  return 'outline'
}

const OutputPane = (props: { readonly row: JobRow; readonly t: BackgroundJobsTranslate }): JSX.Element => {
  const api = useApi(backgroundJobsApi)
  const output = useQuery({
    queryKey: ['background-jobs', 'output', props.row.id],
    queryFn: async ({ signal }) => api.output({ jobId: props.row.id, from: 0 }, { signal }),
    refetchInterval: isLiveStatus(props.row.status) ? 1_500 : false,
  })
  if (output.isPending) {
    return (
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
        <Spinner aria-hidden /> {props.t('loading')}
      </div>
    )
  }
  if (output.isError) {
    return <div className="dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-destructive">{errorMessage(output.error, props.t('loadFailed'))}</div>
  }
  const text = output.data.chunks.map(chunk => `[${chunk.channel ?? 'out'}] ${chunk.text}`).join('')
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:bg-muted/30 dshx:px-3 dshx:py-2">
      {output.data.available ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{output.data.reason ?? props.t('outputUnavailable')}</p>}
      {output.data.available && text.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('noOutputYet')}</p> : null}
      {text.length === 0 ? null : <pre className="dshx:max-h-72 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:font-mono! dshx:text-xs">{text}</pre>}
      {output.data.spilled.length === 0 ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground">
          {props.t('spilled')}: <span className="dshx:font-mono!">{output.data.spilled.join(' ')}</span>
        </p>
      )}
    </div>
  )
}

const JobLine = (props: {
  readonly row: JobRow
  readonly now: number
  readonly t: BackgroundJobsTranslate
  readonly armed: boolean
  readonly stopping: boolean
  readonly selected: boolean
  readonly onToggleSelection: (id: string) => void
  readonly onRangeSelection: (id: string) => void
  readonly sessionLabel: (sessionId: string) => string
  readonly onStop: (row: JobRow) => void
  readonly onArm: (row: JobRow) => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const modifiedCheckboxClick = useRef(false)
  const row = props.row
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  const running = isLiveStatus(row.status)
  return (
    <div
      className={cn('dshx:flex dshx:flex-col dshx:rounded-md dshx:border', props.selected ? 'dshx:border-info/60 dshx:bg-info/8' : 'dshx:border-border')}
      data-job-id={row.id}
    >
      <div className="dshx:flex dshx:items-start dshx:gap-2 dshx:px-3 dshx:py-2">
        {running ? (
          <input
            type="checkbox"
            aria-label={`${props.t('selectJob')} ${row.id}`}
            checked={props.selected}
            onClick={event => {
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return
              modifiedCheckboxClick.current = true
              event.stopPropagation()
              if (event.shiftKey) props.onRangeSelection(row.id)
              else props.onToggleSelection(row.id)
            }}
            onChange={() => {
              if (modifiedCheckboxClick.current) {
                modifiedCheckboxClick.current = false
                return
              }
              props.onToggleSelection(row.id)
            }}
            className="dshx:mt-1 dshx:size-3.5 dshx:shrink-0 dshx:accent-[var(--color-info)]"
          />
        ) : (
          <span aria-hidden className="dshx:mt-1 dshx:w-3.5 dshx:shrink-0" />
        )}
        <Button variant="ghost" size="icon" aria-label={open ? props.t('hideOutput') : props.t('showOutput')} onClick={() => setOpen(current => !current)}>
          <Chevron aria-hidden />
        </Button>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Badge variant="outline">{props.t(CATEGORY_KEY[row.category])}</Badge>
            <Badge variant={statusVariant(row.status)}>
              {running ? <Spinner aria-hidden className="dshx:size-3" /> : null}
              {props.t(STATUS_KEY[row.status])}
              {row.detail === null ? '' : ` · ${row.detail}`}
            </Badge>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {row.kind} · {durationLabel(row, props.now)} · {formatStarted(row.startedAt, props.now)}
            </span>
          </div>
          <code className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs" title={row.label}>
            {row.label}
          </code>
          <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{row.owner === null ? row.id : props.sessionLabel(row.owner)}</span>
        </div>
        {running ? (
          <Button
            variant={props.armed ? 'default' : 'outline'}
            size="sm"
            className="dshx:shrink"
            disabled={props.stopping}
            onClick={() => (props.armed ? props.onStop(row) : props.onArm(row))}
          >
            {props.t(props.armed ? 'stopConfirm' : 'stop')}
          </Button>
        ) : null}
      </div>
      {open ? <OutputPane row={row} t={props.t} /> : null}
    </div>
  )
}

const IndexingNotice = (props: { readonly board: JobBoard; readonly t: BackgroundJobsTranslate }): JSX.Element | null => {
  const indexing = props.board.indexing
  if (indexing.lastError !== null) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {props.t('indexError')}: {indexing.lastError}
        </AlertDescription>
      </Alert>
    )
  }
  if (indexing.caughtUp && !indexing.active) return null
  return (
    <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
      <Spinner aria-hidden className="dshx:size-3" /> {props.t('indexing')} {indexing.indexedFiles} {props.t('filesOf')} {indexing.files} {props.t('logFiles')}
    </p>
  )
}

export interface BackgroundJobsPanelProps {
  readonly sessions: ISessions
  readonly uiWorkspace: UiWorkspace
  readonly t: BackgroundJobsTranslate
}

export function BackgroundJobsPanel(props: BackgroundJobsPanelProps): JSX.Element {
  const api = useApi(backgroundJobsApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [scope, setScope] = useState<JobScope>('running')
  const [group, setGroup] = useState<'session' | 'category' | 'none'>('session')
  const [categories, setCategories] = useState<readonly JobCategory[]>([])
  const [search, setSearch] = useState('')
  const [armed, setArmed] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const [stopError, setStopError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ListSelection<string>>(() => ListSelectionModel.empty())
  const [confirmingStop, setConfirmingStop] = useState(false)
  const [batchStopping, setBatchStopping] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const debouncedSearch = useDebouncedValue({ value: search, delayMs: 250 })
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const filter = useMemo(() => {
    const next: BoardQueryDraft = { scope, limit: PAGE_LIMIT }
    if (categories.length > 0) next.categories = [...categories]
    if (debouncedSearch.trim().length > 0) next.search = debouncedSearch.trim()
    return next
  }, [scope, categories, debouncedSearch])

  const board = useQuery({
    queryKey: [...boardKey, filter],
    queryFn: async ({ signal }) => api.board(filter, { signal }),
    refetchInterval: scope === 'running' ? POLL_LIVE_MS : POLL_IDLE_MS,
  })

  const refresh = useMutation({
    mutationFn: async () => api.refresh({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  })

  const stop = useMutation({
    mutationFn: async (row: JobRow) => api.kill({ jobId: row.id, confirm: true }),
    onSuccess: () => {
      setStopping(null)
      setArmed(null)
      setStopError(null)
      void queryClient.invalidateQueries({ queryKey: boardKey })
    },
    onError: error => {
      setStopping(null)
      setStopError(errorMessage(error, t('stopFailed')))
    },
  })

  const value = board.data
  const rows = useMemo(() => value?.rows ?? [], [value])
  const stoppableIds = useMemo(() => JobSelectionModel.stoppableIds(rows), [rows])
  useEffect(() => {
    setSelection(current => {
      const next = ListSelectionModel.prune({ state: current, visibleIds: stoppableIds })
      return next.ids.length === current.ids.length && next.anchorId === current.anchorId ? current : next
    })
  }, [stoppableIds])
  const selectedJobIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const clearSelection = (): void => setSelection(ListSelectionModel.empty())
  const toggleJobSelection = (id: string): void => setSelection(current => ListSelectionModel.toggle({ state: current, id }))
  const extendJobSelection = (id: string): void => setSelection(current => ListSelectionModel.extend({ state: current, orderedIds: stoppableIds, id }))
  const stopSelected = async (): Promise<void> => {
    setBatchStopping(true)
    setStopError(null)
    try {
      const outcome = await JobSelectionModel.stop({
        ids: selection.ids,
        kill: async jobId => api.kill({ jobId, confirm: true }),
      })
      if (outcome.failed.length > 0) {
        setSelection({ ids: outcome.failed, anchorId: outcome.failed[0] })
        setStopError(t('batchStopPartial', { requested: outcome.requested.length, failed: outcome.failed.length }))
      } else {
        setConfirmingStop(false)
        clearSelection()
      }
      await queryClient.invalidateQueries({ queryKey: boardKey })
    } catch (error) {
      setStopError(errorMessage(error, t('stopFailed')))
    } finally {
      setBatchStopping(false)
    }
  }
  const briefs = useMemo(() => new Map((value?.sessions ?? []).map(session => [session.id, session])), [value])
  const labelOf = useCallback(
    (owner: string): string => (sessionTarget(props.sessions, owner) === undefined ? (briefs.get(owner)?.title ?? sessionLabel(owner)) : sessionLabel(owner)),
    [briefs, sessionLabel, props.sessions],
  )
  const toggleCategory = (category: JobCategory): void =>
    setCategories(current => (current.includes(category) ? current.filter(entry => entry !== category) : [...current, category]))

  const groups = useMemo(() => {
    const grouped = new Map<string, { readonly key: string; readonly label: string; readonly rows: JobRow[] }>()
    for (const row of rows) {
      const key = group === 'category' ? row.category : group === 'session' ? (row.owner ?? '__unowned__') : '__all__'
      const label =
        group === 'category'
          ? t(CATEGORY_KEY[row.category])
          : group === 'session'
            ? row.owner === null
              ? t('unknownSession')
              : labelOf(row.owner)
            : t('scopeAll')
      const existing = grouped.get(key)
      if (existing === undefined) grouped.set(key, { key, label, rows: [row] })
      else existing.rows.push(row)
    }
    return [...grouped.values()]
  }, [rows, group, labelOf, t])

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
              {value?.runningCount ?? 0} {t('running')}
            </Badge>
            <Badge variant="outline">
              {value?.finishedCount ?? 0} {t('finished')}
            </Badge>
            <Badge variant="outline">
              {value?.indexing.historyRows ?? 0} {t('historyRows')}
            </Badge>
            <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCwIcon aria-hidden /> {t('refresh')}
            </Button>
          </div>
        </header>

        {value !== undefined && !value.liveAvailable ? (
          <Alert>
            <AlertDescription>{t('liveUnavailable')}</AlertDescription>
          </Alert>
        ) : null}
        {value === undefined ? null : <IndexingNotice board={value} t={t} />}
        {stopError === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{stopError}</AlertDescription>
          </Alert>
        )}

        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:items-stretch">
          <ToggleGroup
            aria-label={t('scopeAll')}
            size="sm"
            type="single"
            value={scope}
            onValueChange={next => {
              if (next === 'running' || next === 'finished' || next === 'all') setScope(next)
            }}
          >
            <ToggleGroupItem value="running">{t('scopeRunning')}</ToggleGroupItem>
            <ToggleGroupItem value="finished">{t('scopeFinished')}</ToggleGroupItem>
            <ToggleGroupItem value="all">{t('scopeAll')}</ToggleGroupItem>
          </ToggleGroup>
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
          <Select value={group} onValueChange={next => setGroup(next === 'category' || next === 'none' ? next : 'session')}>
            <SelectTrigger aria-label={t('groupBy')} className="dshx:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="session">{t('groupSession')}</SelectItem>
              <SelectItem value="category">{t('groupCategory')}</SelectItem>
              <SelectItem value="none">{t('groupNone')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
          <span className="dshx:text-xs dshx:text-muted-foreground">{t('categories')}</span>
          {jobCategoryValues.map(category => (
            <Button key={category} size="sm" variant={categories.includes(category) ? 'secondary' : 'ghost'} onClick={() => toggleCategory(category)}>
              {t(CATEGORY_KEY[category])}
              <span className="dshx:ml-1 dshx:text-xs dshx:text-muted-foreground">{value?.categoryCounts[category] ?? 0}</span>
            </Button>
          ))}
          {categories.length === 0 ? null : (
            <Button size="sm" variant="ghost" onClick={() => setCategories([])}>
              {t('clearCategories')}
            </Button>
          )}
        </div>

        {stoppableIds.length === 0 ? null : (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
            <input
              type="checkbox"
              aria-label={t('selectAllStoppable')}
              checked={ListSelectionModel.isComplete({ state: selection, orderedIds: stoppableIds })}
              onChange={() => setSelection(current => ListSelectionModel.toggleAllVisible({ state: current, orderedIds: stoppableIds }))}
              className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
            />
            <span className="dshx:text-muted-foreground">{t('selectAllStoppable')}</span>
          </div>
        )}

        <Separator />

        {board.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <Spinner aria-hidden /> {t('loading')}
          </p>
        ) : null}
        {board.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(board.error, t('loadFailed'))}</AlertDescription>
          </Alert>
        ) : null}
        {board.isSuccess && rows.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noJobs')}</p> : null}
        {value !== undefined && value.hasMore ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {value.total - rows.length} {t('moreMatched')}
          </p>
        ) : null}

        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          {groups.map(section => (
            <section key={section.key} className="dshx:flex dshx:flex-col dshx:gap-2">
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <h2 className="dshx:text-sm dshx:font-medium">{section.label}</h2>
                <Badge variant="outline">{section.rows.length}</Badge>
                {group === 'session' && section.key.startsWith('session-') ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={sessionTarget(props.sessions, section.key) === undefined}
                    title={sessionTarget(props.sessions, section.key) === undefined ? t('sessionUnavailable') : t('openSession')}
                    onClick={() => {
                      const target = sessionTarget(props.sessions, section.key)
                      if (target !== undefined) props.uiWorkspace.openSession(target)
                    }}
                  >
                    {t('openSession')}
                  </Button>
                ) : null}
              </div>
              <div className="dshx:flex dshx:flex-col dshx:gap-2">
                {section.rows.map(row => (
                  <JobLine
                    key={row.id}
                    row={row}
                    now={now}
                    t={t}
                    armed={armed === row.id}
                    stopping={stopping === row.id && stop.isPending}
                    selected={selectedJobIds.has(row.id)}
                    onToggleSelection={toggleJobSelection}
                    onRangeSelection={extendJobSelection}
                    sessionLabel={labelOf}
                    onArm={target => setArmed(target.id)}
                    onStop={target => {
                      setStopping(target.id)
                      setStopError(null)
                      stop.mutate(target)
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {selection.ids.length === 0 ? null : (
          <div className="dshx:sticky dshx:bottom-2 dshx:z-30 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-2 dshx:pl-3 dshx:text-[13px] dshx:shadow-lg">
            <span className="dshx:mr-2 dshx:tabular-nums">{t('selectedCount', { count: selection.ids.length })}</span>
            <Button size="sm" variant="destructive" onClick={() => setConfirmingStop(true)}>
              {t('stopSelected')}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              {t('clearSelection')}
            </Button>
          </div>
        )}

        <AlertDialog
          open={confirmingStop}
          onOpenChange={open => {
            if (!open && !batchStopping) setConfirmingStop(false)
          }}
        >
          <AlertDialogContent className="dshx-root" size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="dshx:text-sm">{t('stopSelectedTitle', { count: selection.ids.length })}</AlertDialogTitle>
              <AlertDialogDescription>{t('stopSelectedDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={batchStopping}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={batchStopping || selection.ids.length === 0}
                onClick={event => {
                  event.preventDefault()
                  void stopSelected()
                }}
              >
                {batchStopping ? t('stopping') : t('stopSelectedConfirm', { count: selection.ids.length })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

/** The store's own branded identity for a Session the Host has listed, or undefined when it is not open. */
const sessionTarget = (sessions: ISessions, sessionId: string): SessionTarget | undefined =>
  Object.values(sessions.list.getSnapshot().byId).find(summary => summary?.id === sessionId)?.id
