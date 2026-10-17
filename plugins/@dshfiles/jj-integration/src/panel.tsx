import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PaletteApi, type PaletteActionContext } from '@dshfiles/command-palette/api'
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
import { Card, CardContent, CardHeader } from '@dshfiles/plugin-ui/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  EllipsisIcon,
  GitForkIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jjIntegrationApi, type ThreadView, type WorkspaceSyncView } from './api.js'
import { sessionPreviewMessages } from './session-preview.js'
import { useDiscardConfirmation } from './discard-machine.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import type { JjIntegrationTranslate } from './locales.js'
import { integrationQueueMachine, type IntegrationJob, type IntegrationJobPhase } from './integration-queue-machine.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import { threadIntegrationBlockReason, threadIntegrationState, type ThreadIntegrationState } from './thread-integration-state.js'
import { useToast } from './toast.js'

export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: (path: string) => ['jj-integration', 'thread', path] as const,
  workspaceSync: ['jj-integration', 'workspace-sync'] as const,
}
export const threadRebaseMutationKey = ['jj-integration', 'thread-rebase'] as const

/** Rows one group shows before it offers to reveal the rest. */
const GROUP_LIMIT = 6

/** One row layout for every workspace: select, id, thread, activity, revisions, bookmark, status, blocker, actions. */
const ROW_GRID =
  'dshx:grid dshx:grid-cols-[1.25rem_minmax(6rem,0.6fr)_minmax(7.5rem,1.3fr)_minmax(4rem,0.45fr)_minmax(8rem,0.8fr)_minmax(9.5rem,1fr)_auto_minmax(2rem,0.5fr)_auto] dshx:items-center dshx:gap-x-2'

type IntegrationFilter = 'all' | ThreadIntegrationState | 'inactive'

type ToneClasses = { readonly solid: string; readonly text: string; readonly chip: string; readonly dot: string }

const toneClasses = {
  ready: {
    solid: 'dshx:bg-success',
    text: 'dshx:text-success',
    chip: 'dshx:border-success/30 dshx:bg-success/10 dshx:text-success',
    dot: 'dshx:bg-success',
  },
  conflicts: {
    solid: 'dshx:bg-destructive',
    text: 'dshx:text-destructive',
    chip: 'dshx:border-destructive/30 dshx:bg-destructive/10 dshx:text-destructive',
    dot: 'dshx:bg-destructive',
  },
  waiting: {
    solid: 'dshx:bg-warning',
    text: 'dshx:text-warning',
    chip: 'dshx:border-warning/30 dshx:bg-warning/10 dshx:text-warning',
    dot: 'dshx:bg-warning',
  },
  'up-to-date': {
    solid: 'dshx:bg-muted-foreground',
    text: 'dshx:text-muted-foreground',
    chip: 'dshx:border-border dshx:bg-muted dshx:text-muted-foreground',
    dot: 'dshx:bg-muted-foreground',
  },
} satisfies Record<ThreadIntegrationState, ToneClasses>

const statusChip = (props: { readonly label: string; readonly tone: ThreadIntegrationState }): JSX.Element => (
  <Badge variant="outline" className={cn('dshx:gap-1.5 dshx:px-2.5 dshx:py-1', toneClasses[props.tone].chip)}>
    <span className={cn('dshx:size-1.5 dshx:rounded-full', toneClasses[props.tone].dot)} aria-hidden="true" />
    {props.label}
  </Badge>
)

const groupIcon = (tone: ThreadIntegrationState): JSX.Element => {
  const Icon = tone === 'conflicts' ? CircleAlertIcon : tone === 'waiting' ? ClockIcon : CircleCheckIcon
  return <Icon className="dshx:size-4" />
}

const groupGlyph = (tone: ThreadIntegrationState): JSX.Element => (
  <span
    aria-hidden="true"
    className={cn(
      'dshx:mt-0.5 dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-white',
      toneClasses[tone].solid,
    )}
  >
    {groupIcon(tone)}
  </span>
)

/** The branch diagram: the thread's own revision branching off the base it landed on, then the bookmark it still trails. */
const IntegrationGlyph = (props: { readonly behind: number; readonly pending: number; readonly muted: boolean }): JSX.Element => {
  const branch = props.muted || props.pending === 0 ? 'dshx:text-muted-foreground/60' : 'dshx:text-primary'
  const base = props.muted ? 'dshx:text-muted-foreground/60' : 'dshx:text-primary'
  const tail = props.muted || props.behind > 0 ? 'dshx:text-muted-foreground/60' : base
  return (
    <svg viewBox="0 0 59 18" aria-hidden="true" className="dshx:h-3.5 dshx:w-11.5 dshx:shrink-0">
      <g className={branch}>
        <path d="M2 2.5V15.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="2" cy="2.5" r="2.2" fill="currentColor" />
        <circle cx="2" cy="15.5" r="2.2" fill="currentColor" />
        <path d="M2 2.5C2 7.4 4.6 9 13 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </g>
      <path d="M13 9H29.4" className={base} stroke="currentColor" strokeWidth="1.8" fill="none" />
      <circle cx="34" cy="9" r="4.6" className={base} stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M38.6 9H49.2" className={tail} stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="53.5" cy="9" r="4.3" className={tail} stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

/** The thread sidebar owns restarting DSH (with its confirmation dialog) and registers it as a palette action. */
const RESTART_ACTION_ID = '@dshfiles/thread-sidebar/action/restart-dsh'
const NO_PALETTE_CONTEXT: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }
const findRestartAction = () => PaletteApi.getSnapshot().actions.find(action => action.id === RESTART_ACTION_ID) ?? null
const noRestartAction = (): null => null

const describeWorkspaceSync = (t: JjIntegrationTranslate, view: WorkspaceSyncView): string => {
  if (view.state === 'running') return t('workspaceSyncRunning', { workspace: view.workspace, bookmark: view.bookmark })
  if (view.status === 'up-to-date') return t('workspaceSyncUpToDate', { workspace: view.workspace, bookmark: view.bookmark })
  if (view.status === 'conflicted')
    return `${t('workspaceSyncConflicted', { workspace: view.workspace, files: view.conflicts.join(', ') })} ${view.message ?? ''}`.trim()
  if (view.status !== 'synced') return t('workspaceSyncFailed', { workspace: view.workspace, message: view.message ?? view.status ?? '' })
  if (view.pluginsRebuilt.length === 0 && !view.restartNeeded) return t('workspaceSyncedQuiet', { workspace: view.workspace })
  const effect = view.restartNeeded ? t('workspaceSyncRestart') : t('workspaceSyncLive')
  return t('workspaceSynced', { workspace: view.workspace, count: view.pluginsRebuilt.length, effect })
}

/** What the background sync after the last rebase did to the checkout running DSH, with the restart it may need. */
const WorkspaceSyncLine = (props: { readonly t: JjIntegrationTranslate }): JSX.Element | null => {
  const api = useApi(jjIntegrationApi)
  const restart = useSyncExternalStore(PaletteApi.subscribe, findRestartAction, noRestartAction)
  const sync = useQuery({
    queryKey: threadQueryKeys.workspaceSync,
    retry: false,
    // A Host older than this client has no workspaceSync method: show nothing until DSH restarts.
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 15_000, request: hostSignal => api.workspaceSync({}, { signal: hostSignal }) }).catch(() => ({ sync: null })),
    refetchInterval: query => (query.state.data?.sync?.state === 'running' ? 2_000 : false),
  })
  const view = sync.data?.sync
  if (view === null || view === undefined) return null
  return (
    <Alert variant={view.state === 'failed' ? 'destructive' : 'default'}>
      <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        {view.state === 'running' ? <Spinner /> : null}
        <span>{describeWorkspaceSync(props.t, view)}</span>
        {view.restartNeeded && restart !== null ? (
          <Button size="sm" variant="outline" onClick={() => void restart.run(NO_PALETTE_CONTEXT)}>
            {props.t('restart')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

const SessionConversationPreview = (props: {
  readonly id: string
  readonly session: SessionSummary
  readonly sessions: ISessions
  readonly t: JjIntegrationTranslate
}): JSX.Element => {
  const messages = useQuery({
    queryKey: ['jj-integration', 'session-preview', props.session.id],
    queryFn: ({ signal }) =>
      props.sessions.using(props.session.id, { source: 'controllerOperation', signal }, async reference => {
        const binding = await reference.ready
        return sessionPreviewMessages(binding.eventSource.getSnapshot().entries)
      }),
  })

  return (
    <div
      id={props.id}
      role="region"
      aria-label={props.t('previewFor', { title: props.session.displayTitle })}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:bg-muted/50 dshx:p-2"
    >
      {messages.isPending ? (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <Spinner /> {props.t('previewLoading')}
        </p>
      ) : null}
      {messages.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(messages.error, props.t('previewFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {messages.data?.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('previewNoMessages')}</p> : null}
      {messages.data?.map(message => (
        <div key={message.seq} className="dshx:min-w-0 dshx:text-xs">
          <span className="dshx:font-medium">{props.t(message.role === 'user' ? 'you' : 'assistant')}</span>
          <p className="dshx:break-words dshx:whitespace-pre-wrap dshx:text-muted-foreground">{message.text}</p>
        </div>
      ))}
    </div>
  )
}

const userMessagesLabel = (t: JjIntegrationTranslate, count: number): string => (count === 1 ? t('userMessage', { count }) : t('userMessages', { count }))

const activityLabel = (t: JjIntegrationTranslate, at: number, now: number): string => {
  const age = relativeTime(at, now)
  if (age.unit === 'now') return t('timeNow')
  if (age.unit === 'minutes') return t('timeMinutes', { n: age.n })
  if (age.unit === 'hours') return t('timeHours', { n: age.n })
  if (age.unit === 'days') return t('timeDays', { n: age.n })
  if (age.unit === 'months') return t('timeMonths', { n: age.n })
  return t('timeYears', { n: age.n })
}

const integrationStateLabel = (t: JjIntegrationTranslate, state: ThreadIntegrationState, thread: ThreadView): string => {
  if (state === 'ready') return t('readyToIntegrate')
  if (state === 'conflicts') return t('conflict')
  if (state === 'waiting') return t('waiting')
  return thread.rebasedAt === undefined ? t('upToDateHeading') : t('integrated')
}

const integrationJobLabel = (t: JjIntegrationTranslate, phase: IntegrationJobPhase): string => {
  if (phase === 'queued') return t('integrationQueued')
  if (phase === 'integrating') return t('integrationInProgress')
  if (phase === 'validating') return t('integrationValidating')
  if (phase === 'rebasing') return t('integrationRebasing')
  if (phase === 'integrated') return t('integrated')
  if (phase === 'conflicts') return t('conflict')
  if (phase === 'needs-description') return t('describeFirst')
  if (phase === 'up-to-date') return t('upToDateHeading')
  return t('integrationFailed')
}

const integrationBlockMessage = (t: JjIntegrationTranslate, reason: ReturnType<typeof threadIntegrationBlockReason>, bookmark: string): string | undefined => {
  if (reason === undefined) return undefined
  if (reason === 'missing') return t('missingWorkspaceNextStep')
  if (reason === 'conflicts') return t('resolveConflictsNextStep')
  if (reason === 'active') return t('waitForThreadNextStep')
  if (reason === 'question') return t('answerQuestionNextStep')
  if (reason === 'description') return t('describeRevisionsNextStep')
  if (reason === 'activity-unknown') return t('activityUnknownNextStep')
  return t('behindWithoutWorkNextStep', { bookmark })
}

/**
 * A repository scan costs one jj process per workspace, and a thread whose eligibility is still unknown
 * re-asks for it on every render; one refresh per window is enough to learn the activity that resolves it.
 */
const ELIGIBILITY_REFRESH_INTERVAL_MS = 10_000
let lastEligibilityRefreshAt = 0
const refreshRepositoriesForUnknownEligibility = (queryClient: ReturnType<typeof useQueryClient>): void => {
  const now = Date.now()
  if (now - lastEligibilityRefreshAt < ELIGIBILITY_REFRESH_INTERVAL_MS) return
  lastEligibilityRefreshAt = now
  void queryClient.invalidateQueries({ queryKey: threadQueryKeys.repositories })
}

const ThreadRow = (props: {
  readonly thread: ThreadView
  readonly sessionById: ReadonlyMap<string, SessionSummary>
  readonly userMessagesBySession: ReadonlyMap<string, number>
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly state: ThreadIntegrationState
  readonly selected: boolean
  readonly selectable: boolean
  readonly job: IntegrationJob | undefined
  readonly busy: boolean
  readonly now: number
  readonly onSelect: () => void
  readonly onIntegrate: () => void
  readonly onDiscard: () => void
}): JSX.Element => {
  const { thread, t } = props
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewId = useId()
  const subscribe = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readSessionRunning = useCallback(
    () => Object.values(props.sessions.list.getSnapshot().byId).some(session => session.cwd === thread.path && session.running),
    [props.sessions, thread.path],
  )
  const readClientCanRebase = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return ThreadRebaseEligibilityModel.canRebase(thread.sessionIds, sessionId => {
      const session = sessions[SessionId(sessionId)]
      return session === undefined
        ? undefined
        : { running: session.running, pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) }
    })
  }, [props.sessions, thread.sessionIds])
  const readClientQuestionPending = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return (
      thread.sessionIds.some(sessionId => ThreadRebaseEligibilityModel.hasPendingUserQuestion(sessions[SessionId(sessionId)]?.projectionValues) === true) ||
      Object.values(sessions).some(
        session => session.cwd === thread.path && ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) === true,
      )
    )
  }, [props.sessions, thread.path, thread.sessionIds])
  const sessionRunning = useSyncExternalStore(subscribe, readSessionRunning, () => true)
  const clientCanRebase = useSyncExternalStore(subscribe, readClientCanRebase, () => false)
  const sessionWaitingForInput = useSyncExternalStore(subscribe, readClientQuestionPending, () => true)
  const safeToIntegrate = thread.canRebase === true && clientCanRebase && !sessionRunning && !sessionWaitingForInput
  const state = safeToIntegrate ? props.state : threadIntegrationState({ ...thread, canRebase: false })
  const blockReason = threadIntegrationBlockReason({
    thread,
    sessionRunning,
    sessionWaitingForInput,
    sessionActivityUnknown: thread.canRebase === true && !clientCanRebase && !sessionRunning && !sessionWaitingForInput,
    state,
  })
  const mainSession = thread.sessionIds.map(sessionId => props.sessionById.get(sessionId)).find(session => session !== undefined)
  useEffect(() => {
    if (thread.canRebase !== false || !clientCanRebase) return
    refreshRepositoriesForUnknownEligibility(queryClient)
  }, [clientCanRebase, queryClient, thread.canRebase])
  const statusLabel = props.job === undefined ? integrationStateLabel(t, state, thread) : integrationJobLabel(t, props.job.phase)
  const statusDescription = props.job?.message ?? integrationBlockMessage(t, blockReason, props.bookmark)
  const updatedAt = thread.sessionIds.reduce<number | undefined>((latest, sessionId) => {
    const updated = props.sessionById.get(sessionId)?.updatedAt
    if (updated === undefined) return latest
    return latest === undefined || updated > latest ? updated : latest
  }, undefined)
  const tip = thread.unlanded[0]
  const subtitle = tip === undefined ? thread.rebasedTipChangeId : tip.changeId
  const userMessages = thread.sessionIds.reduce<{ count: number; known: boolean }>(
    (totals, sessionId) => {
      if (props.sessionById.get(sessionId)?.origin === 'subagent') return totals
      const count = props.userMessagesBySession.get(sessionId)
      if (count === undefined) return totals
      return { count: totals.count + count, known: true }
    },
    { count: 0, known: false },
  )
  const behindLabel =
    thread.behindCount === undefined
      ? thread.behind
        ? t('behind', { bookmark: props.bookmark })
        : t('onBookmark', { bookmark: props.bookmark })
      : thread.behindCount > 0
        ? t('commitsBehind', { count: thread.behindCount, bookmark: props.bookmark })
        : t('onBookmark', { bookmark: props.bookmark })
  const title =
    mainSession === undefined ? (
      <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{thread.name}</span>
    ) : (
      <Button
        size="sm"
        variant="ghost"
        className="dshx:min-w-0 dshx:justify-start dshx:truncate dshx:px-1 dshx:font-medium"
        title={mainSession.displayTitle}
        aria-label={t('openThread', { title: mainSession.displayTitle })}
        onClick={() => props.openSession(mainSession.id)}
      >
        {mainSession.displayTitle}
      </Button>
    )
  const subtitleLine = (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
      {subtitle === undefined ? null : <span className="dshx:truncate dshx:font-mono">{subtitle}</span>}
      <span className="dshx:shrink-0">{t('revisionCount', { count: thread.unlanded.length })}</span>
    </span>
  )
  const activityLine = (
    <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:whitespace-nowrap dshx:text-xs dshx:text-muted-foreground">
      <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-70" />
      {updatedAt === undefined ? '—' : activityLabel(t, updatedAt, props.now)}
    </span>
  )
  const messagesLine = (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
      <UsersIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-70" />
      <span className="dshx:truncate" title={userMessages.known ? userMessagesLabel(t, userMessages.count) : undefined}>
        {userMessages.known ? userMessagesLabel(t, userMessages.count) : '—'}
      </span>
    </span>
  )
  const bookmarkLine = (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      <IntegrationGlyph behind={thread.behindCount ?? (thread.behind ? 1 : 0)} pending={thread.unlanded.length} muted={state === 'up-to-date'} />
      <span className={cn('dshx:whitespace-nowrap dshx:text-xs', thread.behind ? toneClasses.waiting.text : 'dshx:text-muted-foreground')}>{behindLabel}</span>
    </span>
  )
  const actions = (
    <>
      {state === 'ready' ? (
        <Button size="sm" disabled={props.busy || props.job !== undefined} onClick={props.onIntegrate}>
          {t('integrate')}
        </Button>
      ) : null}
      {props.job?.phase === 'failed' ? (
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onIntegrate}>
          {t('retryIntegration')}
        </Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={props.busy} aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
        {t(expanded ? 'hideDetails' : 'showDetails')}
        <ChevronDownIcon className={cn('dshx:transition-transform', expanded && 'dshx:rotate-180')} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" disabled={props.busy} aria-label={t('moreActions', { name: thread.name })}>
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={props.onDiscard}>
            {thread.unlanded.length > 0 ? t('removeWorkspaceWorkMenu') : t('removeWorkspaceMenu')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
  return (
    <li className="dshx:border-b dshx:border-border dshx:last:border-b-0">
      <div
        className={cn(
          ROW_GRID,
          'dshx:px-3 dshx:py-2.5',
          'dshx:@max-pane-compact:grid-cols-[auto_minmax(0,1fr)_auto] dshx:@max-pane-compact:gap-x-2 dshx:@max-pane-compact:gap-y-1.5 dshx:@max-pane-compact:py-3',
        )}
      >
        <input
          type="checkbox"
          className="dshx:size-4 dshx:accent-primary dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-1"
          aria-label={t('selectWorkspace', { name: thread.name })}
          checked={props.selected}
          disabled={!props.selectable || props.busy}
          onChange={props.onSelect}
        />
        <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-1">
          {thread.name}
        </span>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:@max-pane-compact:col-span-3 dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-2">
          {title}
          {subtitleLine}
        </div>
        <span className="dshx:@max-pane-compact:col-start-3 dshx:@max-pane-compact:row-start-1 dshx:@max-pane-compact:justify-self-end">{activityLine}</span>
        <span className="dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-3">{messagesLine}</span>
        <span className="dshx:@max-pane-compact:col-span-2 dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-3">{bookmarkLine}</span>
        <span className="dshx:w-fit dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-4">
          {statusChip({ label: statusLabel, tone: state })}
        </span>
        {statusDescription === undefined ? (
          <span className="dshx:@max-pane-compact:col-span-2 dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-4" />
        ) : (
          <span
            className="dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:col-span-2 dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-4"
            title={statusDescription}
          >
            {statusDescription}
          </span>
        )}
        <span className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1 dshx:@max-pane-compact:col-span-3 dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-5 dshx:@max-pane-compact:flex-wrap dshx:@max-pane-compact:justify-start">
          {actions}
        </span>
      </div>
      {expanded ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:bg-muted/20 dshx:px-12 dshx:py-3 dshx:@max-pane-narrow:px-3">
          {blockReason === undefined ? null : (
            <p className="dshx:text-sm dshx:text-muted-foreground">{integrationBlockMessage(t, blockReason, props.bookmark)}</p>
          )}
          {thread.rebasedAt === undefined ? null : (
            <p className="dshx:text-xs dshx:text-muted-foreground">{t('lastIntegrated', { date: new Date(thread.rebasedAt).toLocaleString() })}</p>
          )}
          {thread.unlanded.length > 0 ? (
            <ul className="dshx:flex dshx:flex-col dshx:gap-1">
              {thread.unlanded.map(revision => (
                <li key={revision.commitId} className="dshx:min-w-0 dshx:text-xs">
                  <span className="dshx:font-mono dshx:text-muted-foreground">{revision.changeId}</span>{' '}
                  <span className="dshx:font-sans">{revision.description}</span>
                  {revision.conflict ? <Badge variant="destructive">{t('conflict')}</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {thread.sessionIds.length > 0 ? (
            <ul className="dshx:flex dshx:flex-col dshx:gap-1">
              {thread.sessionIds.map(sessionId => {
                const session = props.sessionById.get(sessionId)
                return (
                  <li key={sessionId}>
                    {session === undefined ? (
                      <span className="dshx:font-mono dshx:text-xs">{sessionId}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="dshx:justify-start"
                        aria-label={t('openThread', { title: session.displayTitle })}
                        onClick={() => props.openSession(session.id)}
                      >
                        {session.displayTitle}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
          {mainSession === undefined ? null : (
            <div>
              <Button size="sm" variant="outline" aria-expanded={previewOpen} aria-controls={previewId} onClick={() => setPreviewOpen(open => !open)}>
                {t(previewOpen ? 'hidePreview' : 'preview')}
              </Button>
              {previewOpen ? <SessionConversationPreview id={previewId} session={mainSession} sessions={props.sessions} t={t} /> : null}
            </div>
          )}
        </div>
      ) : null}
    </li>
  )
}

const DiscardDialog = (props: { readonly t: JjIntegrationTranslate; readonly confirmation: ReturnType<typeof useDiscardConfirmation> }): JSX.Element => {
  const { t, confirmation } = props
  const target = confirmation.target
  const failure = confirmation.failure
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={open => {
        if (!open && !confirmation.busy) confirmation.cancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target === null
              ? null
              : target.unlandedCount > 0
                ? t('removeWorkspaceWithWorkTitle', { name: target.name, count: target.unlandedCount })
                : t('removeWorkspaceTitle', { name: target.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target !== null && target.unlandedCount > 0
              ? t('removeWorkspaceWithWorkDescription', { count: target.unlandedCount })
              : t('removeWorkspaceDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{failure.kind === 'has-work' ? t('hasWork') : (failure.message ?? t('discardFailed'))}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirmation.busy} onClick={confirmation.cancel}>
            {t('cancel')}
          </AlertDialogCancel>
          {failure?.kind === 'has-work' ? null : (
            <AlertDialogAction
              disabled={confirmation.busy}
              variant="destructive"
              onClick={event => {
                event.preventDefault()
                confirmation.confirm()
              }}
            >
              {confirmation.busy ? <Spinner /> : null}
              {target !== null && target.unlandedCount > 0 ? t('removeWorkspaceWorkConfirm') : t('removeWorkspaceConfirm')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const PanelSkeleton = (): JSX.Element => (
  <Card aria-hidden>
    <CardHeader>
      <Skeleton className="dshx:h-5 dshx:w-40" />
      <Skeleton className="dshx:h-4 dshx:w-72" />
    </CardHeader>
    <CardContent className="dshx:flex dshx:flex-col dshx:gap-2">
      <Skeleton className="dshx:h-12 dshx:w-full" />
      <Skeleton className="dshx:h-12 dshx:w-full" />
    </CardContent>
  </Card>
)

/** Relative activity times stay honest while the page sits open. */
const useMinuteTick = (): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

interface SessionDirectory {
  readonly byId: ReadonlyMap<string, SessionSummary>
  /** Turns that carried a human prompt, per session: the Host's `turnOutline` projection. */
  readonly userMessagesBySession: ReadonlyMap<string, number>
}

/** Session rows plus the whole-log turn outline, which the Host serves without opening a conversation. */
const useSessionDirectory = (sessions: ISessions): SessionDirectory => {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const readSnapshot = useCallback(() => sessions.list.getSnapshot(), [sessions])
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  const byId = useMemo(() => new Map<string, SessionSummary>(Object.values(snapshot.byId).map(session => [session.id, session])), [snapshot.byId])
  const userMessagesBySession = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [sessionId, projection] of Object.entries(snapshot.projectionsBySession)) {
      const outline = projection.values.turnOutline
      if (outline === undefined) continue
      counts.set(sessionId, outline.filter(entry => entry.prompt.trim().length > 0).length)
    }
    return counts
  }, [snapshot.projectionsBySession])
  return { byId, userMessagesBySession }
}

export const ThreadWorkspacesPanel = (props: {
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
}): JSX.Element => {
  const { t } = props
  const now = useMinuteTick()
  const { byId: sessionById, userMessagesBySession } = useSessionDirectory(props.sessions)
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const rebasesPending = useIsMutating({ mutationKey: threadRebaseMutationKey }) > 0
  const toast = useToast()
  const [notice, setNotice] = useState<{ readonly tone: 'default' | 'destructive'; readonly text: string } | null>(null)
  const repositories = useQuery({
    queryKey: threadQueryKeys.repositories,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => api.repositories({}, { signal: hostSignal }) }),
  })
  const refreshAfterChange = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['jj-integration'] })
    announceRepositoryChange()
  }
  const rebase = useMutation({
    mutationKey: threadRebaseMutationKey,
    mutationFn: (input: { readonly path: string; readonly signal: AbortSignal }) =>
      runHostRequest({ signal: input.signal, timeoutMs: 300_000, request: signal => api.land({ path: input.path }, { signal }) }),
    onSuccess: async (result, input) => {
      if (result.status === 'landed') {
        await queryClient.cancelQueries({ queryKey: threadQueryKeys.repositories })
        queryClient.setQueryData<Awaited<ReturnType<typeof api.repositories>>>(threadQueryKeys.repositories, previous => {
          if (previous === undefined) return previous
          return {
            repositories: previous.repositories.map(repository => ({
              ...repository,
              threads: repository.threads.map(thread => (thread.path === input.path ? { ...thread, unlanded: [], behind: false } : thread)),
            })),
          }
        })
        setNotice(null)
        toast.show({ text: t('integrationComplete', { count: result.revisions.length, bookmark: result.bookmark }), success: true })
        return
      }
      setNotice({
        tone: result.status === 'nothing-to-land' ? 'default' : 'destructive',
        text: result.status === 'nothing-to-land' ? t('upToDateNoChanges') : describeLandResult(t, result),
      })
    },
    onError: error => setNotice({ tone: 'destructive', text: errorMessage(error, t('loadFailed')) }),
    onSettled: refreshAfterChange,
  })
  const [queueSnapshot, queueSend] = useMachine(integrationQueueMachine, {
    input: { client: { land: ({ path, signal }) => rebase.mutateAsync({ path, signal }) } },
  })
  const activeIntegrationPath = queueSnapshot.context.activePath
  const integrationProgress = useQuery({
    queryKey: ['jj-integration', 'integration-progress', activeIntegrationPath],
    enabled: activeIntegrationPath !== null,
    retry: false,
    queryFn: ({ signal }) =>
      activeIntegrationPath === null
        ? Promise.resolve({ progress: null })
        : runHostRequest({
            signal,
            timeoutMs: 15_000,
            request: hostSignal => api.integrationProgress({ path: activeIntegrationPath }, { signal: hostSignal }),
          }),
    refetchInterval: query => (activeIntegrationPath !== null && query.state.status !== 'error' ? 350 : false),
  })
  useEffect(() => {
    if (activeIntegrationPath === null || integrationProgress.data?.progress === null || integrationProgress.data?.progress === undefined) return
    queueSend({ type: 'progress', path: activeIntegrationPath, phase: integrationProgress.data.progress.phase })
  }, [activeIntegrationPath, integrationProgress.data?.progress, queueSend])
  const integrationJobs = queueSnapshot.context.jobs
  const queueBusy = queueSnapshot.hasTag('busy')
  const discard = useDiscardConfirmation({
    client: {
      discard: (input, options) =>
        runHostRequest({ signal: options.signal, timeoutMs: 120_000, request: hostSignal => api.discard(input, { signal: hostSignal }) }),
    },
    onSettled: refreshAfterChange,
  })
  const [filter, setFilter] = useState<IntegrationFilter>('all')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState<Readonly<Record<string, boolean>>>({})
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const repositoriesWithThreads = repositories.data?.repositories.filter(repository => repository.threads.length > 0)
  const threads = repositoriesWithThreads?.flatMap(repository => repository.threads.map(thread => ({ repository, thread }))) ?? []
  const requestedProjections = useRef(new Set<string>())
  useEffect(() => {
    for (const { thread } of threads) {
      for (const sessionId of thread.sessionIds) {
        if (requestedProjections.current.has(sessionId)) continue
        requestedProjections.current.add(sessionId)
        // The turn/step figures live in the sessionStats projection; a push frame carries them without opening the log.
        void props.sessions.refreshProjections(SessionId(sessionId)).catch(() => undefined)
      }
    }
  }, [props.sessions, threads])
  const categoryOf = (thread: ThreadView): ThreadIntegrationState => {
    const state = threadIntegrationState(thread)
    if (state !== 'ready') return state
    const sessionIsRunning = [...sessionById.values()].some(session => session.cwd === thread.path && session.running)
    const userQuestionIsPending = thread.sessionIds.some(
      sessionId => ThreadRebaseEligibilityModel.hasPendingUserQuestion(sessionById.get(sessionId)?.projectionValues) === true,
    )
    const threadSessionsAreEligible = ThreadRebaseEligibilityModel.canRebase(thread.sessionIds, sessionId => {
      const session = sessionById.get(sessionId)
      return session === undefined
        ? undefined
        : { running: session.running, pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) }
    })
    return sessionIsRunning || userQuestionIsPending || !threadSessionsAreEligible ? 'waiting' : state
  }
  /** A workspace whose Sessions are all archived is inactive; one DSH never opened is not. */
  const isInactive = ({ thread }: { readonly thread: ThreadView }): boolean => thread.sessionIds.length > 0 && thread.finished
  const liveThreads = threads.filter(entry => !isInactive(entry))
  const inactiveThreads = threads.filter(isInactive)
  const counts = {
    all: liveThreads.length,
    ready: liveThreads.filter(({ thread }) => categoryOf(thread) === 'ready').length,
    conflicts: liveThreads.filter(({ thread }) => categoryOf(thread) === 'conflicts').length,
    waiting: liveThreads.filter(({ thread }) => categoryOf(thread) === 'waiting').length,
    'up-to-date': liveThreads.filter(({ thread }) => categoryOf(thread) === 'up-to-date').length,
    inactive: inactiveThreads.length,
  } satisfies Record<IntegrationFilter, number>
  const eligibleThreads = liveThreads.filter(({ thread }) => categoryOf(thread) === 'ready')
  const selectedEligiblePaths = eligibleThreads.filter(({ thread }) => selectedPaths.has(thread.path)).map(({ thread }) => thread.path)
  const startIntegration = (paths: readonly string[]): void => {
    if (queueBusy || rebasesPending) return
    for (const path of paths) void queryClient.removeQueries({ queryKey: ['jj-integration', 'integration-progress', path] })
    queueSend({ type: 'start', paths })
    setSelectedPaths(new Set())
  }
  const toggleSelectedPath = (path: string): void => {
    setSelectedPaths(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const visibleThreads = (filter === 'inactive' ? inactiveThreads : liveThreads).filter(({ thread }) => {
    const query = search.trim().toLocaleLowerCase()
    const matchesSearch =
      query === '' ||
      [thread.name, ...thread.sessionIds.map(id => sessionById.get(id)?.displayTitle ?? ''), ...thread.unlanded.map(revision => revision.description)]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    return matchesSearch && (filter === 'all' || filter === 'inactive' || categoryOf(thread) === filter)
  })
  const groups: readonly {
    readonly id: ThreadIntegrationState
    readonly title: string
    readonly description: string
    readonly emptyTitle: string
    readonly emptyBody: string
  }[] = [
    {
      id: 'conflicts',
      title: t('conflictsHeading'),
      description: t('conflictsDescription'),
      emptyTitle: t('emptyConflictsTitle'),
      emptyBody: t('emptyConflictsBody'),
    },
    {
      id: 'ready',
      title: t('readyToIntegrate'),
      description: t('readyDescription', { bookmark: props.bookmark }),
      emptyTitle: t('emptyReadyTitle'),
      emptyBody: t('emptyReadyBody'),
    },
    {
      id: 'waiting',
      title: t('waitingHeading'),
      description: t('waitingDescription', { bookmark: props.bookmark }),
      emptyTitle: t('emptyWaitingTitle'),
      emptyBody: t('emptyWaitingBody'),
    },
    {
      id: 'up-to-date',
      title: t('upToDateHeading'),
      description: t('upToDateDescription', { bookmark: props.bookmark }),
      emptyTitle: t('emptyUpToDateTitle'),
      emptyBody: t('emptyUpToDateBody', { bookmark: props.bookmark }),
    },
  ]
  const tabs: readonly { readonly id: IntegrationFilter; readonly label: string; readonly dot: string | undefined }[] = [
    { id: 'all', label: t('allThreads'), dot: undefined },
    { id: 'ready', label: t('readyToIntegrate'), dot: toneClasses.ready.dot },
    { id: 'waiting', label: t('waitingHeading'), dot: toneClasses.waiting.dot },
    { id: 'conflicts', label: t('conflictsHeading'), dot: toneClasses.conflicts.dot },
    { id: 'up-to-date', label: t('upToDateHeading'), dot: toneClasses['up-to-date'].dot },
  ]

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:flex-col dshx:gap-5 dshx:overflow-auto dshx:p-6 dshx:@max-pane-narrow:p-3">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:gap-4">
        <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-3">
          <span
            aria-hidden="true"
            className="dshx:mt-0.5 dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:bg-muted dshx:text-muted-foreground"
          >
            <GitForkIcon className="dshx:size-5" />
          </span>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle', { bookmark: props.bookmark })}</p>
          </div>
        </div>
        {threads.length > 0 ? (
          <div className="dshx:ml-auto dshx:flex dshx:min-w-64 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:@max-pane-compact:w-full dshx:@max-pane-compact:flex-auto">
            <label className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-background dshx:px-3 dshx:py-2 dshx:text-sm dshx:text-muted-foreground">
              <SearchIcon aria-hidden="true" className="dshx:size-4" />
              <input
                aria-label={t('searchThreads')}
                className="dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:outline-hidden dshx:text-sm"
                placeholder={t('searchThreads')}
                value={search}
                onChange={event => setSearch(event.currentTarget.value)}
              />
            </label>
            <Button size="sm" variant="outline" onClick={() => void repositories.refetch()} disabled={repositories.isFetching}>
              {repositories.isFetching ? <Spinner /> : <RefreshCwIcon />}
              {t('refresh')}
            </Button>
          </div>
        ) : null}
      </header>
      {toast.element}
      <WorkspaceSyncLine t={t} />
      {notice === null ? null : (
        <Alert variant={notice.tone}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {repositories.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(repositories.error, t('loadFailed'))}</AlertDescription>
        </Alert>
      ) : null}
      {repositories.isPending ? <PanelSkeleton /> : null}
      {repositories.data?.repositories.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noRepositories')}</p> : null}
      {repositories.data !== undefined && repositories.data.repositories.length > 0 && threads.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">{t('noThreads')}</p>
      ) : null}
      {threads.length > 0 ? (
        <>
          <nav
            aria-label={t('workspaceFilters')}
            className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1 dshx:self-start dshx:rounded-xl dshx:border dshx:bg-muted/30 dshx:p-1"
          >
            {tabs.map(tab => (
              <Button
                key={tab.id}
                size="sm"
                variant={filter === tab.id ? 'default' : 'ghost'}
                className="dshx:gap-2"
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.dot === undefined ? null : <span className={cn('dshx:size-1.5 dshx:rounded-full', tab.dot)} aria-hidden="true" />}
                {tab.label}
                <span className={cn('dshx:tabular-nums', filter === tab.id ? 'dshx:opacity-80' : 'dshx:text-muted-foreground')}>{counts[tab.id]}</span>
              </Button>
            ))}
            <Separator orientation="vertical" className="dshx:mx-1 dshx:h-5!" />
            <Button
              size="sm"
              variant={filter === 'inactive' ? 'secondary' : 'ghost'}
              className="dshx:gap-2"
              aria-pressed={filter === 'inactive'}
              title={t('inactiveHint')}
              onClick={() => setFilter(filter === 'inactive' ? 'all' : 'inactive')}
            >
              {t('inactiveFilter')}
              <span className="dshx:text-muted-foreground dshx:tabular-nums">{counts.inactive}</span>
            </Button>
          </nav>
          {counts.ready > 0 ? (
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-4 dshx:rounded-xl dshx:border dshx:border-success/30 dshx:bg-success/5 dshx:px-4 dshx:py-3">
              <span
                aria-hidden="true"
                className="dshx:flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-success dshx:text-white"
              >
                <CheckIcon className="dshx:size-5" />
              </span>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                <p className="dshx:text-sm dshx:font-semibold">{t('readyBannerTitle', { count: counts.ready })}</p>
                <p className="dshx:text-xs dshx:text-muted-foreground">{t('readyBannerBody', { bookmark: props.bookmark })}</p>
              </div>
              {selectedEligiblePaths.length === 0 ? null : (
                <Button size="sm" variant="ghost" disabled={queueBusy || rebasesPending} onClick={() => setSelectedPaths(new Set())}>
                  {t('clearSelection')}
                </Button>
              )}
              <Button
                size="sm"
                disabled={queueBusy || rebasesPending}
                onClick={() => startIntegration(selectedEligiblePaths.length > 0 ? selectedEligiblePaths : eligibleThreads.map(({ thread }) => thread.path))}
              >
                {queueBusy ? <Spinner /> : null}
                {selectedEligiblePaths.length > 0
                  ? t('integrateSelected', { count: selectedEligiblePaths.length })
                  : t('integrateAll', { count: counts.ready })}
              </Button>
            </div>
          ) : null}
          {groups.map(group => {
            if (filter !== 'all' && filter !== 'inactive' && filter !== group.id) return null
            const entries = visibleThreads.filter(({ thread }) => categoryOf(thread) === group.id)
            const expandedGroup = showAll[group.id] === true
            const shownEntries = expandedGroup ? entries : entries.slice(0, GROUP_LIMIT)
            const hiddenCount = entries.length - shownEntries.length
            return (
              <section key={group.id} className="dshx:flex dshx:flex-col dshx:gap-3">
                <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-3">
                  {groupGlyph(group.id)}
                  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                    <h2 className="dshx:text-base dshx:font-semibold">
                      {group.title} <span className="dshx:text-muted-foreground">({entries.length})</span>
                    </h2>
                    <p className="dshx:text-sm dshx:text-muted-foreground">{group.description}</p>
                  </div>
                </div>
                {entries.length === 0 ? (
                  <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-xl dshx:border dshx:px-4 dshx:py-5 dshx:text-center">
                    <span className={cn('dshx:mb-1 dshx:[&>svg]:size-5', toneClasses[group.id].text)} aria-hidden="true">
                      {groupIcon(group.id)}
                    </span>
                    <p className="dshx:text-sm dshx:font-medium">{group.emptyTitle}</p>
                    <p className="dshx:text-xs dshx:text-muted-foreground">{group.emptyBody}</p>
                  </div>
                ) : (
                  <div className="dshx:overflow-hidden dshx:rounded-xl dshx:border">
                    {repositoriesWithThreads?.map(repository => {
                      const repoEntries = shownEntries.filter(entry => entry.repository.repoRoot === repository.repoRoot)
                      if (repoEntries.length === 0) return null
                      return (
                        <div key={repository.repoRoot} className="dshx:flex dshx:flex-col">
                          {repositoriesWithThreads.length > 1 ? (
                            <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:bg-muted/30 dshx:px-3 dshx:py-1.5 dshx:text-xs">
                              <span className="dshx:font-medium">{repository.title}</span>
                              <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-muted-foreground">{repository.repoRoot}</span>
                            </div>
                          ) : null}
                          <ul className="dshx:flex dshx:flex-col">
                            {repoEntries.map(({ thread }) => (
                              <ThreadRow
                                key={thread.path}
                                thread={thread}
                                sessionById={sessionById}
                                userMessagesBySession={userMessagesBySession}
                                sessions={props.sessions}
                                openSession={props.openSession}
                                t={t}
                                bookmark={props.bookmark}
                                state={categoryOf(thread)}
                                selected={selectedPaths.has(thread.path)}
                                selectable={categoryOf(thread) === 'ready'}
                                job={integrationJobs.get(thread.path)}
                                busy={queueBusy || rebasesPending}
                                now={now}
                                onSelect={() => toggleSelectedPath(thread.path)}
                                onIntegrate={() => startIntegration([thread.path])}
                                onDiscard={() => discard.request({ path: thread.path, name: thread.name, unlandedCount: thread.unlanded.length })}
                              />
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                    {hiddenCount > 0 ? (
                      <div className="dshx:flex dshx:justify-center dshx:border-t dshx:border-border dshx:bg-muted/20 dshx:py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="dshx:text-muted-foreground"
                          onClick={() => setShowAll(previous => ({ ...previous, [group.id]: true }))}
                        >
                          <ChevronDownIcon />
                          {t('showMoreThreads', { count: hiddenCount })}
                        </Button>
                      </div>
                    ) : null}
                    {expandedGroup && entries.length > GROUP_LIMIT ? (
                      <div className="dshx:flex dshx:justify-center dshx:border-t dshx:border-border dshx:bg-muted/20 dshx:py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="dshx:text-muted-foreground"
                          onClick={() => setShowAll(previous => ({ ...previous, [group.id]: false }))}
                        >
                          <ChevronDownIcon className="dshx:rotate-180" />
                          {t('hideExtraThreads')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            )
          })}
          {visibleThreads.length === 0 && search.trim() !== '' ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noMatchingThreads')}</p> : null}
        </>
      ) : null}
      <DiscardDialog t={t} confirmation={discard} />
    </div>
  )
}
