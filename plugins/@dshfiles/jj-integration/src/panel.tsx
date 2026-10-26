import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useLoadMore } from '@dshfiles/plugin-ui/hooks/use-load-more'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  ClockIcon,
  CopyIcon,
  EllipsisIcon,
  GitForkIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { jjIntegrationApi, type ThreadView, type WorkspaceSyncView } from './api.js'
import { sessionPreviewMessages } from './session-preview.js'
import { useDiscardConfirmation } from './discard-machine.js'
import { IntegrationRecovery } from './integration-recovery.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import type { JjIntegrationTranslate } from './locales.js'
import { integrationQueueMachine, type IntegrationJob, type IntegrationJobPhase } from './integration-queue-machine.js'
import { indexSessionActivity } from './panel-session-activity.js'
import { ThreadSessionSelection } from './thread-session-selection.js'
import { createProjectionRefreshQueue } from './projection-refresh-queue.js'
import { defaultJjIntegrationSettings, jjIntegrationSettings, RepositoryAutoIntegration } from './settings.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import {
  ThreadIntegrationModel,
  type ThreadIntegrationAssessment,
  type ThreadIntegrationBlocker,
  type ThreadIntegrationCategory,
} from './thread-integration-state.js'
import { useToast } from './toast.js'
import { threadAtQueryKey } from './thread-query-keys.js'
import { workspaceSyncOutcome } from './workspace-sync-outcome.js'

export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: threadAtQueryKey,
  workspaceSync: ['jj-integration', 'workspace-sync'] as const,
}
export const threadRebaseMutationKey = ['jj-integration', 'thread-rebase'] as const

/** Rows mounted per group before its boundary reveals the next batch. */
const GROUP_LIMIT = 8

/** One row layout: selection, thread, activity, changes, status/blocker, actions. */
const ROW_GRID =
  'dshx:grid dshx:grid-cols-[1.25rem_minmax(10rem,1.6fr)_minmax(4.5rem,0.5fr)_minmax(7rem,0.8fr)_minmax(10rem,1.1fr)_auto] dshx:items-center dshx:gap-x-3'

type IntegrationFilter = 'attention' | 'all' | 'ready' | 'blocked' | 'conflicts' | 'integrating' | 'completed'
type LifecycleFilter = 'any' | 'active' | 'idle' | 'finished' | 'missing'
type ThreadLifecycle = 'active' | 'waiting-input' | 'idle' | 'finished' | 'missing'
type RowGroup = 'conflicts' | 'ready' | 'blocked' | 'integrating' | 'completed'

const GroupLoadMoreSentinel = (props: { readonly enabled: boolean; readonly resetKey: number; readonly onLoadMore: () => void }): JSX.Element | null => {
  const sentinel = useLoadMore({ enabled: props.enabled, resetKey: props.resetKey, onLoadMore: props.onLoadMore, rootMargin: '0px 0px 500px 0px' })
  if (!props.enabled) return null
  return <div ref={sentinel} aria-hidden="true" style={{ flex: '0 0 1px', height: 1 }} />
}

type ToneClasses = { readonly solid: string; readonly text: string; readonly chip: string; readonly dot: string }

const toneClasses = {
  conflicts: {
    solid: 'dshx:bg-destructive',
    text: 'dshx:text-destructive',
    chip: 'dshx:border-destructive/30 dshx:bg-destructive/10 dshx:text-destructive',
    dot: 'dshx:bg-destructive',
  },
  ready: {
    solid: 'dshx:bg-success',
    text: 'dshx:text-success',
    chip: 'dshx:border-success/30 dshx:bg-success/10 dshx:text-success',
    dot: 'dshx:bg-success',
  },
  blocked: {
    solid: 'dshx:bg-warning',
    text: 'dshx:text-warning',
    chip: 'dshx:border-warning/30 dshx:bg-warning/10 dshx:text-warning',
    dot: 'dshx:bg-warning',
  },
  unknown: {
    solid: 'dshx:bg-warning',
    text: 'dshx:text-warning',
    chip: 'dshx:border-warning/40 dshx:bg-warning/5 dshx:text-warning',
    dot: 'dshx:bg-warning',
  },
  integrating: {
    solid: 'dshx:bg-primary',
    text: 'dshx:text-primary',
    chip: 'dshx:border-primary/30 dshx:bg-primary/10 dshx:text-primary',
    dot: 'dshx:bg-primary',
  },
  integrated: {
    solid: 'dshx:bg-muted-foreground',
    text: 'dshx:text-muted-foreground',
    chip: 'dshx:border-border dshx:bg-muted dshx:text-muted-foreground',
    dot: 'dshx:bg-muted-foreground',
  },
  'no-changes': {
    solid: 'dshx:bg-muted-foreground',
    text: 'dshx:text-muted-foreground',
    chip: 'dshx:border-border dshx:bg-muted dshx:text-muted-foreground',
    dot: 'dshx:bg-muted-foreground',
  },
} satisfies Record<ThreadIntegrationCategory, ToneClasses>

const statusChip = (props: { readonly label: string; readonly tone: ThreadIntegrationCategory }): JSX.Element => (
  <Badge variant="outline" className={cn('dshx:w-fit dshx:gap-1.5 dshx:px-2.5 dshx:py-1', toneClasses[props.tone].chip)}>
    <span className={cn('dshx:size-1.5 dshx:rounded-full', toneClasses[props.tone].dot)} aria-hidden="true" />
    {props.label}
  </Badge>
)

const groupIcon = (category: ThreadIntegrationCategory): JSX.Element => {
  if (category === 'conflicts' || category === 'unknown') return <CircleAlertIcon className="dshx:size-4" />
  if (category === 'ready' || category === 'integrated') return <CircleCheckIcon className="dshx:size-4" />
  if (category === 'integrating') return <GitForkIcon className="dshx:size-4" />
  if (category === 'no-changes') return <CircleSlashIcon className="dshx:size-4" />
  return <ClockIcon className="dshx:size-4" />
}

const groupGlyph = (category: ThreadIntegrationCategory): JSX.Element => (
  <span
    aria-hidden="true"
    className={cn(
      'dshx:mt-0.5 dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-white',
      toneClasses[category].solid,
    )}
  >
    {groupIcon(category)}
  </span>
)

/** The thread sidebar owns restarting DSH (with its confirmation dialog) and registers it as a palette action. */
const RESTART_ACTION_ID = '@dshfiles/thread-sidebar/action/restart-dsh'
const NO_PALETTE_CONTEXT: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }
const findRestartAction = () => PaletteApi.getSnapshot().actions.find(action => action.id === RESTART_ACTION_ID) ?? null
const noRestartAction = (): null => null

const describeWorkspaceSync = (t: JjIntegrationTranslate, view: WorkspaceSyncView): string => {
  const outcome = workspaceSyncOutcome(view)
  if (outcome === 'running') return t('workspaceSyncRunning', { workspace: view.workspace, bookmark: view.bookmark })
  if (outcome === 'up-to-date') return t('workspaceSyncUpToDate', { workspace: view.workspace, bookmark: view.bookmark })
  if (outcome === 'kept')
    return `${t('workspaceSyncKept', { workspace: view.workspace })} ${t('workspaceSyncKeptNext', { message: view.message ?? t('workspaceSyncKeptDefault') })}`
  if (outcome === 'conflicted')
    return `${t('workspaceSyncConflicted', { workspace: view.workspace, files: view.conflicts.join(', ') })} ${view.message ?? ''}`.trim()
  if (outcome === 'failed') return t('workspaceSyncFailed', { workspace: view.workspace, message: view.message ?? view.status ?? '' })
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
  const outcome = workspaceSyncOutcome(view)
  return (
    <Alert variant={outcome === 'failed' || outcome === 'conflicted' ? 'destructive' : 'default'} data-sync-outcome={outcome}>
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

const integrationStatusLabel = (t: JjIntegrationTranslate, assessment: ThreadIntegrationAssessment): string => {
  if (assessment.category === 'ready') return t('readyToIntegrate')
  if (assessment.category === 'conflicts') return t('conflict')
  if (assessment.category === 'blocked') return t('blockedStatus')
  if (assessment.category === 'unknown') return t('unknownStatus')
  if (assessment.category === 'integrating') return t('integrationInProgress')
  if (assessment.category === 'integrated') return t('integrated')
  return t('noChanges')
}

const integrationJobLabel = (t: JjIntegrationTranslate, phase: IntegrationJobPhase): string => {
  if (phase === 'queued') return t('integrationQueued')
  if (phase === 'integrating') return t('integrationInProgress')
  if (phase === 'validating') return t('integrationValidating')
  if (phase === 'rebasing') return t('integrationRebasing')
  if (phase === 'integrated') return t('integrated')
  if (phase === 'conflicts') return t('conflict')
  if (phase === 'needs-description') return t('describeFirst')
  if (phase === 'up-to-date') return t('noChanges')
  return t('integrationFailed')
}

/** The one specific reason a row cannot integrate right now, primary blocker first. */
const blockerMessage = (t: JjIntegrationTranslate, blocker: ThreadIntegrationBlocker, bookmark: string): string => {
  if (blocker === 'missing') return t('blockerMissing')
  if (blocker === 'conflict') return t('blockerConflict', { bookmark })
  if (blocker === 'question') return t('blockerQuestion')
  if (blocker === 'active') return t('blockerActive')
  if (blocker === 'description') return t('blockerDescription')
  return t('blockerActivityUnknown')
}

/** A non-blocking note: a stale base is not work to integrate, so it must not read like one. */
const advisoryMessage = (t: JjIntegrationTranslate, assessment: ThreadIntegrationAssessment, bookmark: string): string | undefined => {
  if (assessment.pendingRevisions > 0) return undefined
  if (assessment.category === 'integrated') return t('alreadyIntegrated')
  if (assessment.behindBookmark > 0) return t('advisoryBehind', { count: assessment.behindBookmark, bookmark })
  return undefined
}

const lifecycleLabel = (t: JjIntegrationTranslate, lifecycle: ThreadLifecycle): string | undefined => {
  if (lifecycle === 'active') return t('lifecycleRunning')
  if (lifecycle === 'waiting-input') return t('lifecycleWaitingInput')
  if (lifecycle === 'finished') return t('lifecycleFinished')
  if (lifecycle === 'missing') return t('lifecycleMissing')
  return undefined
}

const lifecycleOf = (thread: ThreadView, running: boolean, waitingForInput: boolean): ThreadLifecycle => {
  if (thread.missing) return 'missing'
  if (waitingForInput) return 'waiting-input'
  if (running) return 'active'
  if (thread.finished) return 'finished'
  return 'idle'
}

const rowGroupOf = (category: ThreadIntegrationCategory): RowGroup => {
  if (category === 'conflicts') return 'conflicts'
  if (category === 'ready') return 'ready'
  if (category === 'integrating') return 'integrating'
  if (category === 'integrated' || category === 'no-changes') return 'completed'
  return 'blocked'
}

const workspaceTitlePrefix = (title: string | undefined): string | undefined => {
  if (title === undefined) return undefined
  const [prefix] = title.split(' · ')
  const trimmed = prefix?.trim() ?? ''
  return trimmed.length === 0 ? undefined : trimmed
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
  readonly repositoryTitle: string
  readonly assessment: ThreadIntegrationAssessment
  readonly lifecycle: ThreadLifecycle
  /** The Host cached a refusal while every Session the client can see is idle; one refresh settles it. */
  readonly hostEligibilityStale: boolean
  readonly sessionById: ReadonlyMap<string, SessionSummary>
  readonly userMessagesBySession: ReadonlyMap<string, number>
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly selected: boolean
  readonly selectable: boolean
  readonly job: IntegrationJob | undefined
  readonly busy: boolean
  readonly now: number
  readonly onSelect: () => void
  readonly onIntegrate: () => void
  readonly onDiscard: () => void
}): JSX.Element => {
  const { thread, t, assessment } = props
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const previewId = useId()
  useEffect(() => {
    if (!props.hostEligibilityStale) return
    refreshRepositoriesForUnknownEligibility(queryClient)
  }, [props.hostEligibilityStale, queryClient])
  const mainSession = ThreadSessionSelection.mainSessionOf({ sessionIds: thread.sessionIds, sessionById: props.sessionById })
  const listedSessionIds = ThreadSessionSelection.visibleSessionIdsOf({ sessionIds: thread.sessionIds, sessionById: props.sessionById })
  const statusLabel = props.job === undefined ? integrationStatusLabel(t, assessment) : integrationJobLabel(t, props.job.phase)
  const primaryBlocker = props.job?.message ?? (assessment.blocker === undefined ? undefined : blockerMessage(t, assessment.blocker, props.bookmark))
  const statusDescription = primaryBlocker ?? advisoryMessage(t, assessment, props.bookmark)
  const updatedAt = listedSessionIds.reduce<number | undefined>((latest, sessionId) => {
    const updated = props.sessionById.get(sessionId)?.updatedAt
    if (updated === undefined) return latest
    return latest === undefined || updated > latest ? updated : latest
  }, undefined)
  const tip = thread.unlanded[0]
  const title = workspaceTitlePrefix(thread.workspaceTitle) ?? props.repositoryTitle
  /** A durable title only: displayTitle falls back to the folder basename, which is never a thread's name. */
  const sessionTitle = mainSession?.title?.trim() || undefined
  const revisionTitle = tip !== undefined && !ThreadIntegrationModel.isPlaceholderRevisionDescription(tip.description) ? tip.description.trim() : undefined
  const heading = sessionTitle ?? revisionTitle ?? mainSession?.displayTitle ?? title
  const userMessages = listedSessionIds.reduce<{ count: number; known: boolean }>(
    (totals, sessionId) => {
      if (props.sessionById.get(sessionId)?.origin === 'subagent') return totals
      const count = props.userMessagesBySession.get(sessionId)
      if (count === undefined) return totals
      return { count: totals.count + count, known: true }
    },
    { count: 0, known: false },
  )
  const behindLabel =
    assessment.behindBookmark > 0
      ? t('commitsBehind', { count: assessment.behindBookmark, bookmark: props.bookmark })
      : t('onBookmark', { bookmark: props.bookmark })
  const pendingLabel =
    assessment.pendingRevisions === 0
      ? t('noPending')
      : assessment.pendingRevisions === 1
        ? t('pendingRevision', { count: assessment.pendingRevisions })
        : t('pendingRevisions', { count: assessment.pendingRevisions })
  const lifecycleText = lifecycleLabel(t, props.lifecycle)
  const copyName = (): void => {
    void writeClipboard(thread.name).then(ok => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    })
  }
  const details = (
    <>
      {assessment.blockers.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {assessment.blockers.map((blocker, index) => (
            <li
              key={blocker}
              className={cn('dshx:flex dshx:items-start dshx:gap-2 dshx:text-sm', index === 0 ? 'dshx:text-foreground' : 'dshx:text-muted-foreground')}
            >
              <CircleAlertIcon aria-hidden="true" className={cn('dshx:mt-0.5 dshx:size-4 dshx:shrink-0', toneClasses.blocked.text)} />
              <span className="dshx:min-w-0">{blockerMessage(t, blocker, props.bookmark)}</span>
            </li>
          ))}
        </ul>
      )}
      {thread.rebasedAt === undefined ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground">{t('lastIntegrated', { date: new Date(thread.rebasedAt).toLocaleString() })}</p>
      )}
      <dl className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs">
        <dt className="dshx:text-muted-foreground">{t('workspaceColumn')}</dt>
        <dd className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <span className="dshx:truncate dshx:font-mono">{thread.path}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="dshx:shrink-0"
                aria-label={copied ? t('copied') : t('copyWorkspaceId', { name: thread.name })}
                onClick={copyName}
              >
                {copied ? <CheckIcon className="dshx:text-success" /> : <CopyIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? t('copied') : t('copyWorkspaceId', { name: thread.name })}</TooltipContent>
          </Tooltip>
        </dd>
      </dl>
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
      {listedSessionIds.length > 0 ? (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {listedSessionIds.map(sessionId => {
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
    </>
  )
  return (
    <li className="dshx:border-b dshx:border-border dshx:last:border-b-0">
      <div
        className={cn(
          ROW_GRID,
          'dshx:cursor-pointer dshx:px-3 dshx:py-2.5 dshx:hover:bg-muted/40',
          'dshx:@max-pane-compact:grid-cols-[auto_minmax(0,1fr)_auto] dshx:@max-pane-compact:gap-x-2 dshx:@max-pane-compact:gap-y-1.5 dshx:@max-pane-compact:py-3',
        )}
        onClick={() => setExpanded(open => !open)}
      >
        {props.selectable ? (
          <input
            type="checkbox"
            className="dshx:size-4 dshx:accent-primary dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-1"
            aria-label={t('selectWorkspace', { name: thread.name })}
            checked={props.selected}
            disabled={props.busy}
            onClick={event => event.stopPropagation()}
            onChange={props.onSelect}
          />
        ) : (
          <span aria-hidden="true" className="dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-1" />
        )}
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:@max-pane-compact:col-span-3 dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-2">
          {sessionTitle === undefined ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{heading}</span>
              </TooltipTrigger>
              <TooltipContent>{heading}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="dshx:min-w-0 dshx:justify-start dshx:truncate dshx:px-1 dshx:font-medium"
                  aria-label={t('openThread', { title: sessionTitle })}
                  onClick={event => {
                    event.stopPropagation()
                    if (mainSession !== undefined) props.openSession(mainSession.id)
                  }}
                >
                  {sessionTitle}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sessionTitle}</TooltipContent>
            </Tooltip>
          )}
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
            <span className="dshx:truncate dshx:font-mono">{thread.name}</span>
            {lifecycleText === undefined ? null : <span className="dshx:shrink-0">· {lifecycleText}</span>}
          </span>
        </div>
        <span className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:@max-pane-compact:col-start-3 dshx:@max-pane-compact:row-start-1 dshx:@max-pane-compact:justify-self-end">
          <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:whitespace-nowrap dshx:text-xs dshx:text-muted-foreground">
            <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-70" />
            {updatedAt === undefined ? '—' : activityLabel(t, updatedAt, props.now)}
          </span>
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
            <UsersIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-70" />
            {userMessages.known ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="dshx:truncate">{userMessagesLabel(t, userMessages.count)}</span>
                </TooltipTrigger>
                <TooltipContent>{userMessagesLabel(t, userMessages.count)}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="dshx:truncate">—</span>
            )}
          </span>
        </span>
        <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:@max-pane-compact:col-span-2 dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-3">
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs">
            {assessment.pendingRevisions === 0 ? null : <GitForkIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-primary" />}
            <span className={cn('dshx:truncate', assessment.pendingRevisions > 0 ? 'dshx:font-medium' : 'dshx:text-muted-foreground')}>{pendingLabel}</span>
          </span>
          <span className={cn('dshx:truncate dshx:text-xs', assessment.behindBookmark > 0 ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}>
            {behindLabel}
          </span>
        </span>
        <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:@max-pane-compact:col-span-2 dshx:@max-pane-compact:col-start-2 dshx:@max-pane-compact:row-start-4">
          {statusChip({ label: statusLabel, tone: assessment.category })}
          {statusDescription === undefined ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{statusDescription}</span>
              </TooltipTrigger>
              <TooltipContent>{statusDescription}</TooltipContent>
            </Tooltip>
          )}
        </span>
        <span
          className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1 dshx:@max-pane-compact:col-span-3 dshx:@max-pane-compact:col-start-1 dshx:@max-pane-compact:row-start-5 dshx:@max-pane-compact:flex-wrap dshx:@max-pane-compact:justify-start"
          onClick={event => event.stopPropagation()}
        >
          {assessment.category === 'ready' ? (
            <Button size="sm" disabled={props.busy || props.job !== undefined} onClick={props.onIntegrate}>
              {t('integrate')}
            </Button>
          ) : null}
          {props.job?.phase === 'failed' ? (
            <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onIntegrate}>
              {t('retryIntegration')}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={props.busy} aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
                <span className="dshx:sr-only">{t(expanded ? 'hideDetails' : 'showDetails')}</span>
                <ChevronDownIcon className={cn('dshx:transition-transform', expanded && 'dshx:rotate-180')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(expanded ? 'hideDetails' : 'showDetails')}</TooltipContent>
          </Tooltip>
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
        </span>
      </div>
      {expanded ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:bg-muted/20 dshx:px-12 dshx:py-3 dshx:@max-pane-narrow:px-3">{details}</div>
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

interface ThreadEntry {
  readonly thread: ThreadView
  readonly repositoryTitle: string
  readonly repositoryRoot: string
  readonly assessment: ThreadIntegrationAssessment
  readonly lifecycle: ThreadLifecycle
  readonly hostEligibilityStale: boolean
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
  const settings = useSettings(jjIntegrationSettings)
  const autoIntegrationScope = settings.value?.autoIntegrationScope ?? defaultJjIntegrationSettings.autoIntegrationScope
  const excludedRepositoryRoots = settings.value?.autoIntegrationExcludedRepositories ?? defaultJjIntegrationSettings.autoIntegrationExcludedRepositories
  const autoIntegrationApplies = autoIntegrationScope !== 'none'
  const setRepositoryExclusion = async (repositoryRoot: string, excluded: boolean): Promise<void> => {
    const next = excluded ? [...new Set([...excludedRepositoryRoots, repositoryRoot])] : excludedRepositoryRoots.filter(root => root !== repositoryRoot)
    try {
      if (!(await settings.set('autoIntegrationExcludedRepositories', next))) toast.show({ text: t('autoIntegrationSaveFailed'), success: false })
    } catch (error) {
      toast.show({ text: errorMessage(error, t('autoIntegrationSaveFailed')), success: false })
    }
  }
  const [notice, setNotice] = useState<{ readonly tone: 'default' | 'destructive'; readonly text: string } | null>(null)
  const repositories = useQuery({
    queryKey: threadQueryKeys.repositories,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => api.repositories({}, { signal: hostSignal }) }),
    staleTime: 15_000,
    refetchInterval: query => (query.state.data?.refreshing === true ? 5_000 : 60_000),
  })
  const refreshRepositoryViews = async (): Promise<void> => {
    try {
      await api.refreshRepositories({})
    } catch {
      // The Host may still expose only the cache-backed repositories query.
    }
    await repositories.refetch()
  }
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
              threads: repository.threads.map(thread =>
                thread.path === input.path ? { ...thread, unlanded: [], behind: false, behindCount: 0, rebasedAt: Date.now() } : thread,
              ),
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
    onError: error =>
      IntegrationRecovery.isQueued(error)
        ? setNotice({ tone: 'default', text: t('integrationQueuedHint', { bookmark: props.bookmark }) })
        : setNotice({ tone: 'destructive', text: errorMessage(error, t('loadFailed')) }),
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
  const [filter, setFilter] = useState<IntegrationFilter>('attention')
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('any')
  const [search, setSearch] = useState('')
  const [shownCounts, setShownCounts] = useState<Readonly<Partial<Record<RowGroup, number>>>>({})
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const repositoriesWithThreads = useMemo(() => repositories.data?.repositories.filter(repository => repository.threads.length > 0), [repositories.data])
  const showRepositoryHeader = (repositoriesWithThreads?.length ?? 0) > 1 || autoIntegrationApplies || excludedRepositoryRoots.length > 0
  const threads = useMemo(
    () => repositoriesWithThreads?.flatMap(repository => repository.threads.map(thread => ({ repository, thread }))) ?? [],
    [repositoriesWithThreads],
  )
  const projectionRefresh = useMemo(
    () =>
      createProjectionRefreshQueue({
        // The turn/step figures live in the sessionStats projection; a push frame carries them without opening the log.
        refresh: sessionId => props.sessions.refreshProjections(SessionId(sessionId)),
      }),
    [props.sessions],
  )
  useEffect(() => () => projectionRefresh.cancel(), [projectionRefresh])
  /**
   * The client merges the Host's eligibility verdict with the sessions it can see. An id the client cannot read
   * stays unverified rather than passing silently: the Host re-checks when the integration runs either way.
   */
  /** One pass over the session store per snapshot: a row reads its cwd's activity instead of rescanning every session. */
  const sessionActivity = useMemo(
    () =>
      indexSessionActivity(
        [...sessionById.values()].map(session => ({
          cwd: session.cwd,
          running: session.running,
          waitingForInput: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) === true,
        })),
      ),
    [sessionById],
  )
  const entries = useMemo<readonly ThreadEntry[]>(
    () =>
      threads
        .filter(
          ({ thread }) => !ThreadSessionSelection.isUnusedThread({ sessionIds: thread.sessionIds, pendingRevisions: thread.unlanded.length, sessionById }),
        )
        .map(({ repository, thread }) => {
          const cwdActivity = sessionActivity.activityAt(thread.path)
          const running = cwdActivity.running || thread.sessionIds.some(sessionId => sessionById.get(sessionId)?.running === true)
          const waitingForInput =
            cwdActivity.waitingForInput ||
            thread.sessionIds.some(sessionId => ThreadRebaseEligibilityModel.hasPendingUserQuestion(sessionById.get(sessionId)?.projectionValues) === true)
          const clientCanRebase = ThreadRebaseEligibilityModel.canRebase(thread.sessionIds, sessionId => {
            const session = sessionById.get(sessionId)
            return session === undefined
              ? undefined
              : { running: session.running, pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) }
          })
          const integrationAllowed =
            thread.canRebase === false || clientCanRebase === false || running || waitingForInput
              ? false
              : thread.canRebase === true && clientCanRebase === true
                ? true
                : undefined
          return {
            thread,
            repositoryTitle: repository.title,
            repositoryRoot: repository.repoRoot,
            assessment: ThreadIntegrationModel.assess({
              thread,
              running,
              waitingForInput,
              integrationAllowed,
              jobPhase: integrationJobs.get(thread.path)?.phase,
            }),
            lifecycle: lifecycleOf(thread, running, waitingForInput),
            hostEligibilityStale: thread.canRebase === false && clientCanRebase === true,
          }
        }),
    [integrationJobs, sessionActivity, sessionById, threads],
  )
  const lifecycleMatches = (entry: ThreadEntry): boolean => {
    if (lifecycleFilter === 'any') return true
    if (lifecycleFilter === 'active') return entry.lifecycle === 'active' || entry.lifecycle === 'waiting-input'
    return entry.lifecycle === lifecycleFilter
  }
  const lifecycleEntries = entries.filter(lifecycleMatches)
  const counts = {
    all: lifecycleEntries.length,
    attention: lifecycleEntries.filter(entry => entry.assessment.needsAttention).length,
    ready: lifecycleEntries.filter(entry => entry.assessment.category === 'ready').length,
    blocked: lifecycleEntries.filter(entry => entry.assessment.category === 'blocked' || entry.assessment.category === 'unknown').length,
    conflicts: lifecycleEntries.filter(entry => entry.assessment.category === 'conflicts').length,
    integrating: lifecycleEntries.filter(entry => entry.assessment.category === 'integrating').length,
    completed: lifecycleEntries.filter(entry => !entry.assessment.needsAttention).length,
  }
  const eligibleEntries = lifecycleEntries.filter(entry => entry.assessment.category === 'ready')
  const selectedEligiblePaths = eligibleEntries.filter(entry => selectedPaths.has(entry.thread.path)).map(entry => entry.thread.path)
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
  const matchesSearch = (entry: ThreadEntry, query: string): boolean => {
    if (query === '') return true
    const { thread } = entry
    const parts = [
      thread.name,
      thread.path,
      thread.workspaceTitle ?? '',
      thread.workspaceId ?? '',
      entry.repositoryTitle,
      entry.repositoryRoot,
      ...thread.sessionIds.map(sessionId => sessionById.get(sessionId)?.displayTitle ?? ''),
      ...thread.unlanded.flatMap(revision => [revision.description, revision.changeId, revision.commitId]),
    ]
    return parts.join(' ').toLocaleLowerCase().includes(query)
  }
  const visibleEntries = entries.filter(entry => {
    if (!lifecycleMatches(entry)) return false
    if (!matchesSearch(entry, search.trim().toLocaleLowerCase())) return false
    if (filter === 'all') return true
    // A row this page just integrated keeps its outcome on screen instead of leaving the attention view immediately.
    if (filter === 'attention') return entry.assessment.needsAttention || integrationJobs.has(entry.thread.path)
    if (filter === 'ready') return entry.assessment.category === 'ready'
    if (filter === 'conflicts') return entry.assessment.category === 'conflicts'
    if (filter === 'integrating') return entry.assessment.category === 'integrating'
    if (filter === 'blocked') return entry.assessment.category === 'blocked' || entry.assessment.category === 'unknown'
    return !entry.assessment.needsAttention
  })
  useEffect(() => {
    const priority = new Set<string>()
    const shownPerGroup = new Map<RowGroup, number>()
    for (const entry of visibleEntries) {
      const group = rowGroupOf(entry.assessment.category)
      const shown = shownPerGroup.get(group) ?? 0
      if (shown >= (shownCounts[group] ?? GROUP_LIMIT)) continue
      shownPerGroup.set(group, shown + 1)
      for (const sessionId of entry.thread.sessionIds) priority.add(sessionId)
    }
    const background: string[] = []
    for (const { thread } of threads) for (const sessionId of thread.sessionIds) if (!priority.has(sessionId)) background.push(sessionId)
    projectionRefresh.request([...priority], 'visible')
    projectionRefresh.request(background, 'background')
  }, [projectionRefresh, shownCounts, threads, visibleEntries])
  const groups: readonly {
    readonly id: RowGroup
    readonly title: string
    readonly description: string
    readonly tone: ThreadIntegrationCategory
  }[] = [
    {
      id: 'conflicts',
      title: t('conflictsHeading'),
      description: t('conflictsDescription'),
      tone: 'conflicts',
    },
    {
      id: 'ready',
      title: t('readyToIntegrate'),
      description: t('readyDescription', { bookmark: props.bookmark }),
      tone: 'ready',
    },
    {
      id: 'blocked',
      title: t('blockedHeading'),
      description: t('blockedDescription', { bookmark: props.bookmark }),
      tone: 'blocked',
    },
    {
      id: 'integrating',
      title: t('integratingHeading'),
      description: t('integratingDescription'),
      tone: 'integrating',
    },
    {
      id: 'completed',
      title: t('completedHeading'),
      description: t('completedDescription', { bookmark: props.bookmark }),
      tone: 'no-changes',
    },
  ]
  const tabs: readonly { readonly id: IntegrationFilter; readonly label: string; readonly dot: string | undefined }[] = [
    { id: 'attention', label: t('attentionFilter'), dot: undefined },
    { id: 'ready', label: t('readyToIntegrate'), dot: toneClasses.ready.dot },
    { id: 'blocked', label: t('blockedHeading'), dot: toneClasses.blocked.dot },
    { id: 'conflicts', label: t('conflictsHeading'), dot: toneClasses.conflicts.dot },
    { id: 'integrating', label: t('integratingHeading'), dot: toneClasses.integrating.dot },
    { id: 'completed', label: t('completedFilter'), dot: toneClasses['no-changes'].dot },
    { id: 'all', label: t('allThreads'), dot: undefined },
  ]
  const lifecycleOptions: readonly { readonly id: LifecycleFilter; readonly label: string }[] = [
    { id: 'any', label: t('lifecycleAny') },
    { id: 'active', label: t('lifecycleActive') },
    { id: 'idle', label: t('lifecycleIdle') },
    { id: 'finished', label: t('lifecycleFinished') },
    { id: 'missing', label: t('lifecycleMissing') },
  ]
  const lifecycleComboboxOptions: readonly ComboboxOption[] = lifecycleOptions.map(option => ({ value: option.id, label: option.label }))
  const queuedCount = Math.max(queueSnapshot.context.queue.length - (activeIntegrationPath === null ? 0 : 1), 0)
  const failedPaths = [...integrationJobs.entries()].filter(([, job]) => job.phase === 'failed').map(([path]) => path)
  const activeTitle = activeIntegrationPath === null ? undefined : entries.find(entry => entry.thread.path === activeIntegrationPath)?.thread
  const activeLabel =
    activeTitle === undefined
      ? undefined
      : (ThreadSessionSelection.mainSessionOf({ sessionIds: activeTitle.sessionIds, sessionById })?.displayTitle ?? activeTitle.name)
  const queueVisible = queueBusy || failedPaths.length > 0

  return (
    <TooltipProvider>
      <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:p-6 dshx:@max-pane-narrow:p-3">
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshRepositoryViews()}
                disabled={repositories.isFetching || repositories.data?.refreshing === true}
              >
                {repositories.isFetching || repositories.data?.refreshing === true ? <Spinner /> : <RefreshCwIcon />}
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
        {repositories.isPending || (repositories.data?.refreshing === true && repositories.data.repositories.length === 0) ? <PanelSkeleton /> : null}
        {repositories.data?.refreshFailed === true ? (
          <Alert variant="default">
            <AlertDescription>{t('loadFailed')}</AlertDescription>
          </Alert>
        ) : null}
        {repositories.data?.refreshing !== true && repositories.data?.refreshFailed !== true && repositories.data?.repositories.length === 0 ? (
          <p className="dshx:text-sm dshx:text-muted-foreground">{t('noRepositories')}</p>
        ) : null}
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
              <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:text-muted-foreground">
                {t('lifecycleFilter')}
                <Combobox
                  label={t('lifecycleFilter')}
                  onValueChange={value => {
                    const option = lifecycleOptions.find(candidate => candidate.id === value)
                    if (option === undefined) return
                    setLifecycleFilter(option.id)
                  }}
                  options={lifecycleComboboxOptions}
                  triggerClassName="dshx:h-7 dshx:w-auto dshx:bg-background dshx:px-1.5 dshx:text-xs"
                  value={lifecycleFilter}
                />
              </span>
            </nav>
            {queueVisible ? (
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:rounded-xl dshx:border dshx:bg-muted/30 dshx:px-4 dshx:py-2 dshx:text-xs">
                <span className="dshx:font-medium">{t('queueHeading')}</span>
                {activeLabel === undefined ? null : (
                  <span className="dshx:flex dshx:items-center dshx:gap-1.5">
                    {queueBusy ? <Spinner /> : null}
                    {t('queueActive', { name: activeLabel })}
                  </span>
                )}
                {queuedCount === 0 ? null : <span className="dshx:text-muted-foreground">{t('queueQueued', { count: queuedCount })}</span>}
                {failedPaths.length === 0 ? null : <span className="dshx:text-destructive">{t('queueFailed', { count: failedPaths.length })}</span>}
              </div>
            ) : null}
            {counts.ready > 0 && (filter === 'attention' || filter === 'all' || filter === 'ready') ? (
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
                  onClick={() => startIntegration(selectedEligiblePaths.length > 0 ? selectedEligiblePaths : eligibleEntries.map(entry => entry.thread.path))}
                >
                  {queueBusy ? <Spinner /> : null}
                  {selectedEligiblePaths.length > 0
                    ? t('integrateSelected', { count: selectedEligiblePaths.length })
                    : t('integrateAll', { count: counts.ready })}
                </Button>
              </div>
            ) : null}
            {groups.map(group => {
              const entriesInGroup = visibleEntries.filter(entry => rowGroupOf(entry.assessment.category) === group.id)
              if (entriesInGroup.length === 0) return null
              const shownCount = shownCounts[group.id] ?? GROUP_LIMIT
              const shownEntries = entriesInGroup.slice(0, shownCount)
              const hiddenCount = entriesInGroup.length - shownEntries.length
              return (
                <section key={group.id} className="dshx:flex dshx:flex-col dshx:gap-2">
                  <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-3">
                    {groupGlyph(group.tone)}
                    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                      <h2 className="dshx:text-base dshx:font-semibold">
                        {group.title} <span className="dshx:text-muted-foreground">({entriesInGroup.length})</span>
                      </h2>
                      <p className="dshx:text-sm dshx:text-muted-foreground">{group.description}</p>
                    </div>
                  </div>
                  <div className="dshx:overflow-hidden dshx:rounded-xl dshx:border">
                    {repositoriesWithThreads?.map(repository => {
                      const repoEntries = shownEntries.filter(entry => entry.repositoryRoot === repository.repoRoot)
                      if (repoEntries.length === 0) return null
                      const repositoryExcluded = RepositoryAutoIntegration.isExcluded({ repositoryRoot: repository.repoRoot, excludedRepositoryRoots })
                      return (
                        <div key={repository.repoRoot} className="dshx:flex dshx:flex-col">
                          {showRepositoryHeader ? (
                            <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:bg-muted/30 dshx:px-3 dshx:py-1.5 dshx:text-xs">
                              <span className="dshx:font-medium">{repository.title}</span>
                              <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-muted-foreground">{repository.repoRoot}</span>
                              <div className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
                                {repositoryExcluded ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="dshx:inline-flex">
                                        <Badge variant="warning">{t('autoIntegrationOff')}</Badge>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{t('autoIntegrationExcludedHint', { repository: repository.title })}</TooltipContent>
                                  </Tooltip>
                                ) : null}
                                {autoIntegrationApplies ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
                                        <span>{t('autoIntegrationLabel')}</span>
                                        <Switch
                                          size="sm"
                                          checked={!repositoryExcluded}
                                          disabled={!settings.writable || settings.mutation.pending}
                                          aria-label={t('autoIntegrationToggle', { repository: repository.title })}
                                          onCheckedChange={checked => void setRepositoryExclusion(repository.repoRoot, !checked)}
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>{t('autoIntegrationToggleHint', { bookmark: props.bookmark })}</TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <ul className="dshx:flex dshx:flex-col">
                            {repoEntries.map(entry => (
                              <ThreadRow
                                key={entry.thread.path}
                                thread={entry.thread}
                                repositoryTitle={entry.repositoryTitle}
                                assessment={entry.assessment}
                                lifecycle={entry.lifecycle}
                                hostEligibilityStale={entry.hostEligibilityStale}
                                sessionById={sessionById}
                                userMessagesBySession={userMessagesBySession}
                                sessions={props.sessions}
                                openSession={props.openSession}
                                t={t}
                                bookmark={props.bookmark}
                                selected={selectedPaths.has(entry.thread.path)}
                                selectable={entry.assessment.category === 'ready'}
                                job={integrationJobs.get(entry.thread.path)}
                                busy={queueBusy || rebasesPending}
                                now={now}
                                onSelect={() => toggleSelectedPath(entry.thread.path)}
                                onIntegrate={() => startIntegration([entry.thread.path])}
                                onDiscard={() =>
                                  discard.request({ path: entry.thread.path, name: entry.thread.name, unlandedCount: entry.thread.unlanded.length })
                                }
                              />
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                    <GroupLoadMoreSentinel
                      enabled={hiddenCount > 0}
                      resetKey={shownCount}
                      onLoadMore={() =>
                        setShownCounts(current => ({
                          ...current,
                          [group.id]: Math.min(entriesInGroup.length, (current[group.id] ?? GROUP_LIMIT) + GROUP_LIMIT),
                        }))
                      }
                    />
                  </div>
                </section>
              )
            })}
            {visibleEntries.length === 0 ? (
              <p className="dshx:text-sm dshx:text-muted-foreground">
                {search.trim() !== '' ? t('noMatchingThreads') : filter === 'attention' ? t('nothingNeedsAttention') : t('noThreadsInFilter')}
              </p>
            ) : null}
          </>
        ) : null}
        <DiscardDialog t={t} confirmation={discard} />
      </div>
    </TooltipProvider>
  )
}
