import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { MergeConflictGraph, type MergeRevision } from '@dshfiles/plugin-ui/components/motion/merge-conflict-graph'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  FolderGit2Icon,
  GitMergeIcon,
  PanelRightIcon,
  RefreshCwIcon,
  Undo2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useRegistry } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Schema } from 'effect'
import type { ThreadRevisionView, ThreadView } from './api.js'
import { useSessionThreadApi } from './use-session-thread-api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { IntegrationRecovery } from './integration-recovery.js'
import { LandConfirmDialog } from './land-confirm-dialog.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import { REPOSITORY_CHANGED_EVENT } from './repository-change.js'
import { threadQueryKeys } from './panel.js'
import { ThreadRebaseMutation } from './thread-rebase-mutation.js'
import { RevisionGraphHoverCard, revisionGraphQueryKey } from './revision-graph-hover-card.js'
import { SessionLogDownloadRow, type SessionLogDownloadPort } from './session-log-download.js'
import { WorkspaceActivityIndex } from './workspace-activity-index.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import { threadStatusPollMs } from './thread-status-poll.js'
import { useToast } from './toast.js'
import { useProjectBookmark } from './project-bookmark-query.js'
import { WorkspaceControlModel } from './workspace-control-model.js'
import { arrangeWorkspaceMenuSections, WorkspaceMenuSections } from './workspace-menu-sections.js'

export interface ThreadWorkspaceControlProps {
  readonly sessionId: SessionSummary['id']
  readonly sessions: ISessions
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly sessionLog: SessionLogDownloadPort
  readonly openThreadWorkspaces: () => void
}

const noCwd = (): null => null
const contractRejectionSchema = Schema.StructWithRest(Schema.Struct({ kind: Schema.Literal('contract') }), [Schema.Record(Schema.String, Schema.Unknown)])

/** A Session the client already sees keeping this workspace busy, so the hint can name it instead of blaming "this thread". */
interface WorkspaceBlocker {
  readonly title: string
  readonly reason: 'working' | 'question'
}

const CONFLICT_GRAPH_ROWS = 6

/** The thread's unlanded revisions (newest first, one linear line) as conflict-graph rows. */
const conflictGraphRows = (revisions: readonly ThreadRevisionView[]): MergeRevision[] => {
  const shown = revisions.slice(0, CONFLICT_GRAPH_ROWS)
  return shown.map((revision, index) => {
    const parent = shown[index + 1]
    return {
      id: revision.changeId,
      title: revision.description.split('\n')[0] || revision.changeId.slice(0, 8),
      hash: revision.changeId.slice(0, 8),
      lane: 0,
      parents: parent === undefined ? [] : [parent.changeId],
      muted: !revision.conflict,
      conflicts: revision.conflict ? true : undefined,
    }
  })
}

const folderName = (path: string): string =>
  path
    .split('/')
    .filter(segment => segment.length > 0)
    .pop() ?? path

/**
 * One control for this thread's jj workspace: where it edits files and its state, Land, and the thread-workspaces panel.
 * The workspace's folder name appears only in the menu's mono path line (b:212a).
 *
 * It never unmounts: a thread that works in the shared project checkout says so instead of hiding the only entry
 * point to its workspace actions, which is what made the old header look like it had lost the button.
 */
export const ThreadWorkspaceControl = (props: ThreadWorkspaceControlProps): JSX.Element => {
  const api = useSessionThreadApi(props.sessionId)
  const queryClient = useQueryClient()
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [confirmingLand, setConfirmingLand] = useState(false)
  const subscribe = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const read = useCallback(() => props.sessions.list.getSnapshot().byId[props.sessionId]?.cwd ?? null, [props.sessions, props.sessionId])
  const cwd = useSyncExternalStore(subscribe, read, noCwd)
  const bookmark = useProjectBookmark(cwd, props.bookmark)
  const toast = useToast()
  const pathCopy = useCopyFeedback()
  const menuSections = arrangeWorkspaceMenuSections(useRegistry(WorkspaceMenuSections))
  const thread = useQuery({
    queryKey: threadQueryKeys.threadAt(cwd ?? '', props.sessionId),
    enabled: cwd !== null && cwd.length > 0,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<{ readonly thread: ThreadView | null }>(threadQueryKeys.threadAt(cwd ?? '', props.sessionId))
      const read = (input: { readonly path: string; readonly sessionId?: SessionSummary['id'] }) =>
        runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.threadAt(input, { signal: hostSignal }) })
      const current = await read({ path: cwd ?? '', sessionId: props.sessionId }).catch(error => {
        if (!Schema.is(contractRejectionSchema)(error)) throw error
        return read({ path: cwd ?? '' })
      })
      if (previous?.thread?.integrationQueuedAt !== current.thread?.integrationQueuedAt) announceRepositoryChange()
      return current
    },
    refetchInterval: query => {
      const current = query.state.data?.thread
      return threadStatusPollMs({ hasThread: current !== null, queued: current?.integrationQueuedAt !== undefined, menuOpen: workspaceMenuOpen })
    },
  })
  const rebase = useMutation({
    mutationKey: ThreadRebaseMutation.key,
    mutationFn: (input: { readonly path: string }) =>
      runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path: input.path, sessionId: props.sessionId }, { signal }) }),
    onError: (error, input) => {
      if (IntegrationRecovery.isQueued(error)) {
        toast.show({ text: props.t('integrationQueuedHint', { bookmark }), success: true })
        announceRepositoryChange()
        void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(input.path) })
        return
      }
      toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false })
    },
    onSettled: async (result, _error, input) => {
      announceRepositoryChange()
      await queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(input.path) })
      await queryClient.invalidateQueries({ queryKey: revisionGraphQueryKey(input.path) })
      if (result !== undefined && result !== null) toast.show({ text: describeLandResult(props.t, result), success: result.status === 'landed' })
    },
  })
  /** The status refetch runs jj and can take seconds, so the menu shows the Host's answer at once and refreshes behind it. */
  const showQueued = (path: string, integrationQueuedAt: number | undefined): void => {
    announceRepositoryChange()
    queryClient.setQueryData(threadQueryKeys.threadAt(path, props.sessionId), (previous: { readonly thread: ThreadView | null } | undefined) => {
      if (previous?.thread === null || previous?.thread === undefined) return previous
      const { integrationQueuedAt: _previousQueuedAt, ...thread } = previous.thread
      return { thread: integrationQueuedAt === undefined ? thread : { ...thread, integrationQueuedAt } }
    })
    void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(path) })
  }
  const queueIntegration = useMutation({
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 30_000, request: signal => api.queueLand({ path, sessionId: props.sessionId }, { signal }) }),
    onSuccess: (result, path) => showQueued(path, result.queuedAt),
    onError: error => toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false }),
  })
  const undoQueuedIntegration = useMutation({
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 30_000, request: signal => api.cancelQueuedLand({ path }, { signal }) }),
    onSuccess: (result, path) => {
      if (result.status === 'integrating') {
        toast.show({ text: props.t('queuedIntegrationAlreadyRunning'), success: false })
        void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(path) })
        return
      }
      showQueued(path, undefined)
    },
    onError: error => toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false }),
  })
  // The header shows a live verb, so a land made anywhere in this browser (the Changes view, the Land page) updates it
  // at once instead of on the idle poll. A read already in flight is left alone: it announces the change itself.
  useEffect(() => {
    if (cwd === null || cwd.length === 0) return
    const refresh = (): void =>
      void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(cwd, props.sessionId), exact: true }, { cancelRefetch: false })
    window.addEventListener(REPOSITORY_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(REPOSITORY_CHANGED_EVENT, refresh)
  }, [cwd, props.sessionId, queryClient])
  /** Opening the menu reads the status again: work landed outside this browser has no mutation to invalidate it. */
  const onWorkspaceMenuOpenChange = (open: boolean): void => {
    setWorkspaceMenuOpen(open)
    if (open && cwd !== null && cwd.length > 0) void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(cwd, props.sessionId), exact: true })
  }
  const current = thread.data?.thread
  const rebasesPending = useIsMutating(ThreadRebaseMutation.at(current?.path ?? cwd ?? '')) > 0
  const sessionIds = useMemo(() => current?.sessionIds ?? [props.sessionId], [current?.sessionIds, props.sessionId])
  const readSessionRunning = useCallback(
    () => WorkspaceActivityIndex.isRunning({ byId: props.sessions.list.getSnapshot().byId, sessionIds: [], path: current?.path }),
    [current?.path, props.sessions],
  )
  const readClientCanRebase = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return ThreadRebaseEligibilityModel.canRebase(sessionIds, sessionId => {
      const session = sessions[SessionId(sessionId)]
      return session === undefined
        ? undefined
        : { running: session.running, pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) }
    })
  }, [props.sessions, sessionIds])
  const readClientQuestionPending = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return WorkspaceActivityIndex.hasQuestion({ byId: sessions, sessionIds, path: current?.path })
  }, [current?.path, props.sessions, sessionIds])
  const sessionRunning = useSyncExternalStore(subscribe, readSessionRunning, () => true)
  const clientCanRebase = useSyncExternalStore(subscribe, readClientCanRebase, () => false)
  const sessionWaitingForInput = useSyncExternalStore(subscribe, readClientQuestionPending, () => true)
  // The store snapshot itself: useSyncExternalStore compares by identity, so a derived array must not be the snapshot.
  const readSessionsById = useCallback(() => props.sessions.list.getSnapshot().byId, [props.sessions])
  const sessionsById = useSyncExternalStore(subscribe, readSessionsById, readSessionsById)
  const workspaceBlockers = useMemo(() => {
    const seen = new Set<string>()
    const blockers: WorkspaceBlocker[] = []
    const consider = (session: SessionSummary | undefined): void => {
      if (session === undefined || seen.has(session.id)) return
      const pendingUserQuestion = ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues)
      if (!session.running && pendingUserQuestion !== true) return
      seen.add(session.id)
      blockers.push({ title: session.title ?? session.displayTitle, reason: session.running ? 'working' : 'question' })
    }
    for (const sessionId of sessionIds) consider(sessionsById[SessionId(sessionId)])
    for (const session of Object.values(sessionsById)) if (session.cwd === current?.path) consider(session)
    return blockers
  }, [current?.path, sessionIds, sessionsById])
  const canRebase = ThreadRebaseEligibilityModel.fromClientSnapshot({
    threadSessionsEligible: clientCanRebase,
    sessionRunning,
    questionPending: sessionWaitingForInput,
  })

  const unlanded = current?.unlanded.length ?? 0
  const conflicted = current?.unlanded.some(revision => revision.conflict) ?? false
  const isThread = current !== null && current !== undefined
  // `current` is undefined until the status query answers and null when the path is not a thread workspace.
  const loading = current === undefined && cwd !== null
  const name = current?.name ?? (cwd === null || cwd.length === 0 ? props.t('unknownWorkspace') : folderName(cwd))
  // b:212a: the control says where the thread edits files, in the picker's words; the folder name stays in the details.
  const ownWorkspace = isThread || (loading && EntityLabels.isThreadWorkspace(cwd))
  const placeLabel = ownWorkspace ? props.t('workspaceSegmentOwn') : props.t('workspaceSegmentInPlace')
  const label = props.t('rebaseThread', { bookmark })
  const triggerLabel = ownWorkspace ? props.t('currentThreadWorkspace') : props.t('workspaceMenuShared', { name })
  const rebaseDisabled = rebasesPending || !isThread || unlanded === 0 || !canRebase
  const integrationQueued = current?.integrationQueuedAt !== undefined
  const canQueueIntegration = isThread && unlanded > 0 && !canRebase && !rebasesPending
  // H4 (unslop): landing finishes a thread, so the header carries it as its one primary verb while it can run.
  const showsLand = WorkspaceControlModel.showsLand({ isThread, unlanded: current?.unlanded ?? [], canLand: canRebase, queued: integrationQueued })
  // A dialog left without revisions (the work landed elsewhere meanwhile) closes for good, not until the next change.
  useEffect(() => {
    if (unlanded === 0) setConfirmingLand(false)
  }, [unlanded])
  /** Both Land buttons of this control ask first: the dialog lists the revisions that move. */
  const askToLand = (): void => {
    setWorkspaceMenuOpen(false)
    setConfirmingLand(true)
    // Work landed outside this browser (a terminal, the agent's own land) has no event: the dialog lists what is left.
    if (cwd !== null && cwd.length > 0)
      void queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(cwd, props.sessionId), exact: true }, { cancelRefetch: false })
  }
  const blockedReason =
    isThread && !canRebase
      ? clientCanRebase === undefined
        ? props.t('rebaseActivityUnknown')
        : workspaceBlockers.length === 0
          ? props.t('rebaseBlockedUnknownThread')
          : props.t('rebaseBlocked', {
              threads: workspaceBlockers
                .map(blocker => props.t(blocker.reason === 'working' ? 'blockerThreadWorking' : 'blockerThreadWaiting', { thread: blocker.title }))
                .join(', '),
            })
      : undefined
  const statusText = (): string => {
    if (loading) return props.t('workspaceStatusLoading')
    if (!isThread) return props.t('sharedCheckoutHint')
    if (conflicted) return props.t(unlanded === 1 ? 'conflictHintOne' : 'conflictHintMany', { count: unlanded })
    if (unlanded > 0) return props.t('toRebase', { count: unlanded })
    if (current.behind) return props.t('behind', { bookmark })
    return props.t('upToDate')
  }

  const workspacePath = current?.path ?? (cwd !== null && cwd.length > 0 ? cwd : null)
  const glyph = <FolderGit2Icon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0" />
  // b:czs9: the chip never shrinks below what it shows. A shrunk chip centred its count and chevron over the elapsed
  // time and the ⋯ beside it. It sheds parts instead, by the header row's width (an inline-size container): its label
  // below 32rem (after the live activity's elapsed time, 36rem), then its count below 26rem. The count stays in this
  // chip's menu, which the same tap opens.
  // H5 (unslop): the count is the phrase the thread list and the menu use ("1 to land"), never a bare number.
  const countLabel =
    unlanded > 0 ? (
      <span
        className={cn('dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground dshx:@max-[26rem]:hidden', conflicted && 'dshx:text-warning')}
        data-workspace-count=""
      >
        {props.t('toRebase', { count: unlanded })}
      </span>
    ) : null

  const trigger = (
    <Button
      aria-label={triggerLabel}
      className="dshx-root dshx:max-w-60 dshx:gap-1.5 dshx:px-2"
      data-workspace-name={isThread ? current.name : undefined}
      data-workspace-place={ownWorkspace ? 'own' : 'project'}
      size="sm"
      type="button"
      variant="outline"
    >
      {glyph}
      <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:@max-[32rem]:hidden">{placeLabel}</span>
      {countLabel}
      {integrationQueued ? <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" /> : null}
      <ChevronDownIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-60" />
    </Button>
  )

  return (
    <TooltipProvider>
      <span className="dshx-root dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1">
        <Popover open={workspaceMenuOpen} onOpenChange={onWorkspaceMenuOpenChange}>
          {current === null || current === undefined ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent className="dshx:max-w-96">{cwd ?? triggerLabel}</TooltipContent>
            </Tooltip>
          ) : (
            <RevisionGraphHoverCard
              path={current.path}
              bookmark={bookmark}
              disabled={workspaceMenuOpen}
              t={props.t}
              trigger={<PopoverTrigger asChild>{trigger}</PopoverTrigger>}
            />
          )}
          <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:gap-0 dshx:p-0">
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pt-3">
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <FolderGit2Icon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
                <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{placeLabel}</span>
              </div>
              {/* H6 (unslop): the end of the path names the workspace; the whole path is in the tooltip and behind Copy. */}
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground" data-workspace-path="" tabIndex={0}>
                      {workspacePath === null ? props.t('unknownWorkspace') : WorkspaceControlModel.pathTail(workspacePath)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="dshx:max-w-96 dshx:break-all">{workspacePath ?? props.t('unknownWorkspace')}</TooltipContent>
                </Tooltip>
                {workspacePath === null ? null : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={props.t('copyWorkspacePath')}
                        className="dshx-root dshx:shrink-0 dshx:text-muted-foreground"
                        onClick={() => void pathCopy.copy(workspacePath)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        {pathCopy.copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{pathCopy.copied ? props.t('copied') : props.t('copyWorkspacePath')}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            {conflicted && isThread ? (
              <div className="dshx:px-3 dshx:pt-2 dshx:pb-3">
                <MergeConflictGraph
                  data-testid="workspace-conflict-graph"
                  footer={null}
                  heading={statusText()}
                  revisions={conflictGraphRows(current.unlanded)}
                  state={null}
                  target={{
                    label: props.t('rebaseThread', { bookmark }),
                    status: 'conflicts',
                    conflicts: current.unlanded.filter(revision => revision.conflict).length,
                  }}
                />
              </div>
            ) : (
              <p className="dshx:px-3 dshx:pt-2 dshx:pb-3 dshx:text-xs dshx:text-muted-foreground">{statusText()}</p>
            )}
            {loading
              ? null
              : menuSections.map(section => (
                  <section.Component
                    dismiss={() => onWorkspaceMenuOpenChange(false)}
                    key={section.id}
                    ownWorkspace={ownWorkspace}
                    sessionId={String(props.sessionId)}
                  />
                ))}
            {isThread &&
              (integrationQueued ? (
                <div className="dshx:px-3 dshx:pb-3">
                  <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:py-1 dshx:pr-1 dshx:pl-2">
                    <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
                    <p className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">{props.t('integrationQueuedHint', { bookmark })}</p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={props.t('undoQueuedIntegrationLabel', { bookmark })}
                          className="dshx-root dshx:shrink"
                          disabled={undoQueuedIntegration.isPending}
                          onClick={() => undoQueuedIntegration.mutate(current.path)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {undoQueuedIntegration.isPending ? <Spinner /> : <Undo2Icon aria-hidden="true" className="dshx:size-3.5" />}
                          {props.t('undoQueuedIntegration')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">{props.t('undoQueuedIntegrationLabel', { bookmark })}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ) : canQueueIntegration ? (
                <div className="dshx:px-3 dshx:pb-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={props.t('queueIntegration', { bookmark })}
                        className="dshx-root dshx:w-full"
                        disabled={queueIntegration.isPending}
                        onClick={() => queueIntegration.mutate(current.path)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {queueIntegration.isPending ? <Spinner /> : <ClockIcon aria-hidden="true" className="dshx:size-3.5" />}
                        {props.t('queueIntegration', { bookmark })}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{props.t('queueIntegrationHint')}</TooltipContent>
                  </Tooltip>
                  <p className="dshx:pt-2 dshx:text-xs dshx:text-muted-foreground">
                    {blockedReason === undefined ? props.t('queueIntegrationHint') : `${blockedReason} ${props.t('queueIntegrationHint')}`}
                  </p>
                </div>
              ) : (
                <div className="dshx:px-3 dshx:pb-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={label}
                        className="dshx-root dshx:w-full"
                        disabled={rebaseDisabled}
                        onClick={askToLand}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {rebasesPending ? <Spinner /> : <RefreshCwIcon aria-hidden="true" className="dshx:size-3.5" />}
                        {props.t('rebaseOnto', { bookmark })}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {canRebase ? `${label} (${props.t('toRebase', { count: unlanded })})` : `${label} — ${blockedReason}`}
                    </TooltipContent>
                  </Tooltip>
                  {blockedReason === undefined ? null : <p className="dshx:pt-2 dshx:text-xs dshx:text-muted-foreground">{blockedReason}</p>}
                </div>
              ))}
            <Separator />
            <div className="dshx:p-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={props.t('openSidePanel')}
                    className="dshx-root dshx:w-full dshx:justify-start"
                    onClick={props.openThreadWorkspaces}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <PanelRightIcon aria-hidden="true" className="dshx:size-3.5" />
                    {props.t('openSidePanel')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{props.t('openSidePanel')}</TooltipContent>
              </Tooltip>
              <SessionLogDownloadRow sessionId={props.sessionId} port={props.sessionLog} t={props.t} />
            </div>
          </PopoverContent>
        </Popover>
        {showsLand ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={props.t('landThreadLabel')} data-workspace-land="" disabled={rebasesPending} onClick={askToLand} size="sm" type="button">
                {rebasesPending ? <Spinner /> : <GitMergeIcon aria-hidden="true" className="dshx:size-3.5 dshx:@max-[26rem]:hidden" />}
                {props.t('landThreadVerb')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`${label} (${props.t('toRebase', { count: unlanded })})`}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      {isThread ? (
        <LandConfirmDialog
          bookmark={bookmark}
          onConfirm={() => rebase.mutate({ path: current.path })}
          onOpenChange={setConfirmingLand}
          open={confirmingLand && unlanded > 0}
          revisions={current.unlanded}
          t={props.t}
        />
      ) : null}
      {toast.element}
    </TooltipProvider>
  )
}
