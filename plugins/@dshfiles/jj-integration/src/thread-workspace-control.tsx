import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronDownIcon, ClockIcon, FolderGit2Icon, PanelRightIcon, RefreshCwIcon, Undo2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { jjIntegrationApi, type ThreadView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import { threadQueryKeys, threadRebaseMutationKey } from './panel.js'
import { RevisionGraphHoverCard, revisionGraphQueryKey } from './revision-graph-hover-card.js'
import { SessionLogDownloadRow, type SessionLogDownloadPort } from './session-log-download.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import { useToast } from './toast.js'

export interface ThreadWorkspaceControlProps {
  readonly sessionId: SessionSummary['id']
  readonly sessions: ISessions
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly sessionLog: SessionLogDownloadPort
  readonly openThreadWorkspaces: () => void
}

const noCwd = (): null => null

const folderName = (path: string): string =>
  path
    .split('/')
    .filter(segment => segment.length > 0)
    .pop() ?? path

/**
 * One control for this thread's jj workspace: its name and state, Rebase, and the thread-workspaces panel.
 *
 * It never unmounts: a thread that works in the shared project checkout says so instead of hiding the only entry
 * point to its workspace actions, which is what made the old header look like it had lost the button.
 */
export const ThreadWorkspaceControl = (props: ThreadWorkspaceControlProps): JSX.Element => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const rebasesPending = useIsMutating({ mutationKey: threadRebaseMutationKey }) > 0
  const subscribe = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const read = useCallback(() => props.sessions.list.getSnapshot().byId[props.sessionId]?.cwd ?? null, [props.sessions, props.sessionId])
  const cwd = useSyncExternalStore(subscribe, read, noCwd)
  const toast = useToast()
  const thread = useQuery({
    queryKey: threadQueryKeys.threadAt(cwd ?? ''),
    enabled: cwd !== null && cwd.length > 0,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.threadAt({ path: cwd ?? '' }, { signal: hostSignal }) }),
    refetchInterval: query => (query.state.data?.thread === null ? false : 5_000),
  })
  const rebase = useMutation({
    mutationKey: threadRebaseMutationKey,
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path, sessionId: props.sessionId }, { signal }) }),
    onError: error => toast.show({ text: errorMessage(error, props.t('loadFailed')), success: false }),
    onSettled: async (result, _error, path) => {
      announceRepositoryChange()
      await queryClient.invalidateQueries({ queryKey: threadQueryKeys.threadAt(path) })
      await queryClient.invalidateQueries({ queryKey: revisionGraphQueryKey(path) })
      if (result !== undefined && result !== null) toast.show({ text: describeLandResult(props.t, result), success: result.status === 'landed' })
    },
  })
  /** The status refetch runs jj and can take seconds, so the menu shows the Host's answer at once and refreshes behind it. */
  const showQueued = (path: string, integrationQueuedAt: number | undefined): void => {
    queryClient.setQueryData(threadQueryKeys.threadAt(path), (previous: { readonly thread: ThreadView | null } | undefined) => {
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
  const current = thread.data?.thread
  const sessionIds = useMemo(() => current?.sessionIds ?? [props.sessionId], [current?.sessionIds, props.sessionId])
  const readSessionRunning = useCallback(
    () => Object.values(props.sessions.list.getSnapshot().byId).some(session => session.cwd === current?.path && session.running),
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
    return (
      sessionIds.some(sessionId => ThreadRebaseEligibilityModel.hasPendingUserQuestion(sessions[SessionId(sessionId)]?.projectionValues) === true) ||
      (current?.path !== undefined &&
        Object.values(sessions).some(
          session => session.cwd === current.path && ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) === true,
        ))
    )
  }, [current?.path, props.sessions, sessionIds])
  const sessionRunning = useSyncExternalStore(subscribe, readSessionRunning, () => true)
  const clientCanRebase = useSyncExternalStore(subscribe, readClientCanRebase, () => false)
  const sessionWaitingForInput = useSyncExternalStore(subscribe, readClientQuestionPending, () => true)
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
  const label = props.t('rebaseThread', { bookmark: props.bookmark })
  const triggerLabel = isThread ? props.t('currentThreadWorkspace', { name }) : props.t('workspaceMenuShared', { name })
  const rebaseDisabled = rebasesPending || !isThread || unlanded === 0 || !canRebase
  const integrationQueued = current?.integrationQueuedAt !== undefined
  const canQueueIntegration = isThread && unlanded > 0 && !canRebase && !rebasesPending
  const blockedReason = isThread && !canRebase ? props.t(clientCanRebase === undefined ? 'rebaseActivityUnknown' : 'rebaseBlocked') : undefined
  const statusText = (): string => {
    if (loading) return props.t('workspaceStatusLoading')
    if (!isThread) return props.t('sharedCheckoutHint')
    if (conflicted) return props.t('conflictHint', { count: unlanded })
    if (unlanded > 0) return props.t('toRebase', { count: unlanded })
    if (current.behind) return props.t('behind', { bookmark: props.bookmark })
    return props.t('upToDate')
  }

  const glyph = <FolderGit2Icon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0" />
  const countBadge =
    unlanded > 0 ? (
      <Badge
        className={cn('dshx:h-4 dshx:px-1.5 dshx:text-[10px]', conflicted && 'dshx:bg-warning/20 dshx:text-warning')}
        variant={conflicted ? 'ghost' : 'secondary'}
      >
        {unlanded}
      </Badge>
    ) : null

  const trigger = (
    <Button
      aria-label={triggerLabel}
      className="dshx-root dshx:min-w-0 dshx:max-w-44 dshx:shrink dshx:gap-1.5 dshx:px-2"
      size="sm"
      title={current?.path ?? cwd ?? triggerLabel}
      type="button"
      variant="outline"
    >
      {glyph}
      <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{name}</span>
      {countBadge}
      {integrationQueued ? <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" /> : null}
      <ChevronDownIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-60" />
    </Button>
  )

  return (
    <>
      <span className="dshx-root dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <Popover>
          {current === null || current === undefined ? (
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          ) : (
            <RevisionGraphHoverCard path={current.path} bookmark={props.bookmark} t={props.t} trigger={<PopoverTrigger asChild>{trigger}</PopoverTrigger>} />
          )}
          <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:gap-0 dshx:p-0">
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pt-3">
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <FolderGit2Icon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
                <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-sm dshx:font-medium">{name}</span>
              </div>
              <span className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground" title={current?.path ?? cwd ?? ''}>
                {current?.path ?? cwd ?? props.t('unknownWorkspace')}
              </span>
            </div>
            <p className="dshx:px-3 dshx:pt-2 dshx:pb-3 dshx:text-xs dshx:text-muted-foreground">{statusText()}</p>
            {!isThread ? null : integrationQueued ? (
              <div className="dshx:px-3 dshx:pb-3">
                <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:py-1 dshx:pr-1 dshx:pl-2">
                  <ClockIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
                  <p className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">{props.t('integrationQueuedHint', { bookmark: props.bookmark })}</p>
                  <Button
                    aria-label={props.t('undoQueuedIntegrationLabel', { bookmark: props.bookmark })}
                    className="dshx-root dshx:shrink"
                    disabled={undoQueuedIntegration.isPending}
                    onClick={() => undoQueuedIntegration.mutate(current.path)}
                    size="sm"
                    title={props.t('undoQueuedIntegrationLabel', { bookmark: props.bookmark })}
                    type="button"
                    variant="ghost"
                  >
                    {undoQueuedIntegration.isPending ? <Spinner /> : <Undo2Icon aria-hidden="true" className="dshx:size-3.5" />}
                    {props.t('undoQueuedIntegration')}
                  </Button>
                </div>
              </div>
            ) : canQueueIntegration ? (
              <div className="dshx:px-3 dshx:pb-3">
                <Button
                  aria-label={props.t('queueIntegration', { bookmark: props.bookmark })}
                  className="dshx-root dshx:w-full"
                  disabled={queueIntegration.isPending}
                  onClick={() => queueIntegration.mutate(current.path)}
                  size="sm"
                  title={props.t('queueIntegrationHint')}
                  type="button"
                  variant="outline"
                >
                  {queueIntegration.isPending ? <Spinner /> : <ClockIcon aria-hidden="true" className="dshx:size-3.5" />}
                  {props.t('queueIntegration', { bookmark: props.bookmark })}
                </Button>
                <p className="dshx:pt-2 dshx:text-xs dshx:text-muted-foreground">
                  {blockedReason === undefined ? props.t('queueIntegrationHint') : `${blockedReason} ${props.t('queueIntegrationHint')}`}
                </p>
              </div>
            ) : (
              <div className="dshx:px-3 dshx:pb-3">
                <Button
                  aria-label={label}
                  className="dshx-root dshx:w-full"
                  disabled={rebaseDisabled}
                  onClick={() => rebase.mutate(current.path)}
                  size="sm"
                  title={canRebase ? `${label} (${props.t('toRebase', { count: unlanded })})` : `${label} — ${blockedReason}`}
                  type="button"
                  variant="outline"
                >
                  {rebasesPending ? <Spinner /> : <RefreshCwIcon aria-hidden="true" className="dshx:size-3.5" />}
                  {props.t('rebaseOnto', { bookmark: props.bookmark })}
                </Button>
                {blockedReason === undefined ? null : <p className="dshx:pt-2 dshx:text-xs dshx:text-muted-foreground">{blockedReason}</p>}
              </div>
            )}
            <Separator />
            <div className="dshx:p-1">
              <Button
                aria-label={props.t('openSidePanel')}
                className="dshx-root dshx:w-full dshx:justify-start"
                onClick={props.openThreadWorkspaces}
                size="sm"
                title={props.t('openSidePanel')}
                type="button"
                variant="ghost"
              >
                <PanelRightIcon aria-hidden="true" className="dshx:size-3.5" />
                {props.t('openSidePanel')}
              </Button>
              <SessionLogDownloadRow sessionId={props.sessionId} port={props.sessionLog} t={props.t} />
            </div>
          </PopoverContent>
        </Popover>
      </span>
      {toast.element}
    </>
  )
}
