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
import { RollingNumber } from '@dshfiles/plugin-ui/components/motion/text'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page, PageSection, type PageTabs } from '@dshfiles/plugin-ui/components/page'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type { ISessions, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi, useApiEvent } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { backgroundJobsApi } from './api.js'
import { jobCategoryValues, type JobCategory } from './classify.js'
import { JobPreviewModel } from './job-preview-model.js'
import { JobSelectionModel } from './job-selection.js'
import type { BackgroundJobsKey, BackgroundJobsTranslate } from './locales.js'
import { backgroundJobStopMachine } from './stop-machine.js'
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

export const STATUS_KEY = {
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
  return JobPreviewModel.formatElapsed((row.finishedAt ?? now) - row.startedAt)
}

/** A clock alone is ambiguous across days, so anything older than today carries its date. */
const formatStarted = (at: number, now: number): string => {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

/** Job states on the shared vocabulary; the badge keeps the exact job status as detail text. */
const WORK_STATUS = {
  running: 'working',
  stopping: 'working',
  completed: 'done',
  killed: 'done',
  interrupted: 'done',
  failed: 'failed',
} as const satisfies Record<JobStatus, WorkStatus>

export const statusVariant = (status: JobStatus): 'default' | 'secondary' | 'outline' | 'destructive' => {
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

export const JobLine = (props: {
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
  /** False in the thread panel's Jobs facet, which has no batch stop. */
  readonly selectable?: boolean
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const modifiedCheckboxClick = useRef(false)
  const row = props.row
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  const running = isLiveStatus(row.status)
  return (
    <EntityRow
      role="listitem"
      data-job-id={row.id}
      status={WORK_STATUS[row.status]}
      statusDecorative
      selected={props.selected}
      leading={
        <>
          {running && props.selectable !== false ? (
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
              className="dshx:size-3.5 dshx:shrink-0 dshx:accent-[var(--color-info)]"
            />
          ) : (
            <span aria-hidden className="dshx:w-3.5 dshx:shrink-0" />
          )}
          <Button variant="ghost" size="icon-xs" aria-label={open ? props.t('hideOutput') : props.t('showOutput')} onClick={() => setOpen(current => !current)}>
            <Chevron aria-hidden />
          </Button>
        </>
      }
      heading={
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <code className="dshx:block dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs">{row.label}</code>
            </TooltipTrigger>
            <TooltipContent>{row.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
      meta={
        <>
          <Badge variant="outline">{props.t(CATEGORY_KEY[row.category])}</Badge>
          <Badge variant={statusVariant(row.status)}>
            {props.t(STATUS_KEY[row.status])}
            {row.detail === null ? '' : ` · ${row.detail}`}
          </Badge>
          {row.outlivedSince === null ? null : (
            <Badge variant="warning" data-job-outlived>
              {props.t('outlivedTurn')} · {formatStarted(row.outlivedSince, props.now)}
            </Badge>
          )}
          <span className="dshx:truncate">
            {row.kind} · {durationLabel(row, props.now)} · {formatStarted(row.startedAt, props.now)}
          </span>
        </>
      }
      description={row.owner === null ? row.id : props.sessionLabel(row.owner)}
      trailing={
        running ? (
          <Button
            variant={props.armed ? 'default' : 'outline'}
            size="sm"
            className="dshx:shrink"
            disabled={props.stopping}
            onClick={() => (props.armed ? props.onStop(row) : props.onArm(row))}
          >
            {props.t(props.armed ? 'stopConfirm' : 'stop')}
          </Button>
        ) : null
      }
    >
      {open ? <OutputPane row={row} t={props.t} /> : null}
    </EntityRow>
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
  /** The Processes page: its tabs, and the body of a tab other than Jobs (which hides the Jobs controls). */
  readonly heading?: string
  readonly description?: string
  readonly tabs?: PageTabs
  readonly otherTab?: ReactNode
}

export function BackgroundJobsPanel(props: BackgroundJobsPanelProps): JSX.Element {
  const api = useApi(backgroundJobsApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [scope, setScope] = useState<JobScope>('running')
  const [group, setGroup] = useState<'session' | 'category' | 'none'>('session')
  const [categories, setCategories] = useState<readonly JobCategory[]>([])
  const [search, setSearch] = useState('')
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

  const boardEvents = useApiEvent(backgroundJobsApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: boardKey }))
  // Changes made while the event stream was down are not replayed.
  useEffect(() => {
    if (boardEvents === 'live') void queryClient.invalidateQueries({ queryKey: boardKey })
  }, [boardEvents, queryClient])

  const board = useQuery({
    queryKey: [...boardKey, filter],
    queryFn: async ({ signal }) => api.board(filter, { signal }),
    refetchInterval: boardEvents === 'live' ? false : scope === 'running' ? POLL_LIVE_MS : POLL_IDLE_MS,
  })

  const refresh = useMutation({
    mutationFn: async () => api.refresh({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  })

  const [stopSnapshot, sendStop] = useMachine(backgroundJobStopMachine, {
    input: {
      kill: (jobId: string) => api.kill({ jobId, confirm: true }),
      refresh: () => void queryClient.invalidateQueries({ queryKey: boardKey }),
    },
  })
  const value = board.data
  const rows = useMemo(() => value?.rows ?? [], [value])
  const stoppableIds = useMemo(() => JobSelectionModel.stoppableIds(rows), [rows])
  useEffect(() => {
    sendStop({ type: 'visible', ids: stoppableIds })
  }, [stoppableIds, sendStop])
  const selection: ListSelection<string> = stopSnapshot.context.selection
  const selectedJobIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const clearSelection = (): void => sendStop({ type: 'select.clear' })
  const toggleJobSelection = (id: string): void => sendStop({ type: 'select.toggle', id })
  const extendJobSelection = (id: string): void => sendStop({ type: 'select.extend', id, orderedIds: stoppableIds })
  const stopFailure = stopSnapshot.context.failure
  const stopError =
    stopFailure === null
      ? null
      : stopFailure.kind === 'error'
        ? errorMessage(stopFailure.error, t('stopFailed'))
        : t('batchStopPartial', { requested: stopFailure.requested, failed: stopFailure.failed })
  const confirmingStop = stopSnapshot.matches('confirming') || stopSnapshot.matches({ stopping: 'batch' })
  const batchStopping = stopSnapshot.matches({ stopping: 'batch' })
  const stopTargetCount = stopSnapshot.context.targetIds.length
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
    <Page
      heading={props.heading ?? t('title')}
      description={props.description ?? t('subtitle')}
      {...(props.tabs === undefined ? {} : { tabs: props.tabs })}
      meta={
        <>
          <Badge variant="muted">
            <RollingNumber value={value?.runningCount ?? 0} /> {t('running')}
          </Badge>
          <Badge variant="muted">
            <RollingNumber value={value?.finishedCount ?? 0} /> {t('finished')}
          </Badge>
          <Badge variant="muted">
            {value?.indexing.historyRows ?? 0} {t('historyRows')}
          </Badge>
        </>
      }
      actions={
        props.otherTab === undefined
          ? [{ id: 'refresh', label: t('refresh'), icon: <RefreshCwIcon aria-hidden />, pending: refresh.isPending, onSelect: () => refresh.mutate() }]
          : []
      }
    >
      {props.otherTab !== undefined ? (
        props.otherTab
      ) : (
        <>
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
            <SearchInput
              className="dshx:min-w-56 dshx:flex-1 dshx:@max-pane-compact:min-w-0"
              aria-label={t('search')}
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
            />
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

          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1 dshx:@max-pane-compact:flex-nowrap dshx:@max-pane-compact:overflow-x-auto dshx:@max-pane-compact:pb-1">
            <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{t('categories')}</span>
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
                onChange={() => sendStop({ type: 'select.all', orderedIds: stoppableIds })}
                className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
              />
              <span className="dshx:text-muted-foreground">{t('selectAllStoppable')}</span>
            </div>
          )}

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
          {board.isSuccess && rows.length === 0 ? <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">{t('noJobs')}</EmptyState> : null}
          {value !== undefined && value.hasMore ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">
              {value.total - rows.length} {t('moreMatched')}
            </p>
          ) : null}

          <div className="dshx:flex dshx:flex-col dshx:gap-4">
            {groups.map(section => (
              <PageSection
                key={section.key}
                heading={section.label}
                meta={section.rows.length}
                actions={
                  group === 'session' && section.key.startsWith('session-') ? (
                    <TooltipProvider delayDuration={500}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={sessionTarget(props.sessions, section.key) === undefined}
                            onClick={() => {
                              const target = sessionTarget(props.sessions, section.key)
                              if (target !== undefined) props.uiWorkspace.openSession(target)
                            }}
                          >
                            {t('openSession')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{sessionTarget(props.sessions, section.key) === undefined ? t('sessionUnavailable') : t('openSession')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null
                }
              >
                <EntityList>
                  {section.rows.map(row => (
                    <JobLine
                      key={row.id}
                      row={row}
                      now={now}
                      t={t}
                      armed={stopSnapshot.context.armedId === row.id}
                      stopping={stopSnapshot.matches({ stopping: 'single' }) && stopSnapshot.context.targetIds[0] === row.id}
                      selected={selectedJobIds.has(row.id)}
                      onToggleSelection={toggleJobSelection}
                      onRangeSelection={extendJobSelection}
                      sessionLabel={labelOf}
                      onArm={target => sendStop({ type: 'arm', id: target.id })}
                      onStop={() => sendStop({ type: 'stop' })}
                    />
                  ))}
                </EntityList>
              </PageSection>
            ))}
          </div>

          {selection.ids.length === 0 ? null : (
            <div className="dshx:sticky dshx:bottom-2 dshx:z-30 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-2 dshx:pl-3 dshx:text-[13px] dshx:shadow-lg">
              <span className="dshx:mr-2 dshx:tabular-nums">{t('selectedCount', { count: selection.ids.length })}</span>
              <Button size="sm" variant="destructive" onClick={() => sendStop({ type: 'ask' })}>
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
              if (!open && stopSnapshot.matches('confirming')) sendStop({ type: 'cancel' })
            }}
          >
            <AlertDialogContent className="dshx-root" size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle className="dshx:text-sm">{t('stopSelectedTitle', { count: stopTargetCount })}</AlertDialogTitle>
                <AlertDialogDescription>{t('stopSelectedDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={batchStopping}>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={batchStopping || stopTargetCount === 0}
                  onClick={event => {
                    event.preventDefault()
                    sendStop({ type: 'confirm' })
                  }}
                >
                  {batchStopping ? t('stopping') : t('stopSelectedConfirm', { count: stopTargetCount })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </Page>
  )
}

/** The store's own branded identity for a Session the Host has listed, or undefined when it is not open. */
const sessionTarget = (sessions: ISessions, sessionId: string): SessionTarget | undefined =>
  Object.values(sessions.list.getSnapshot().byId).find(summary => summary?.id === sessionId)?.id
