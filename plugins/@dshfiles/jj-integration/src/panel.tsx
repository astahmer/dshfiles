import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { getPaletteActions, subscribePaletteActions, type PaletteActionContext } from '@dshfiles/command-palette/api'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { EllipsisIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { jjIntegrationApi, type ThreadView, type WorkspaceSyncView } from './api.js'
import { sessionPreviewMessages } from './session-preview.js'
import { useDiscardConfirmation } from './discard-machine.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import type { JjIntegrationTranslate } from './locales.js'
import { canRebaseThread, hasPendingUserQuestion } from './thread-rebase-eligibility.js'
import { useToast } from './toast.js'

export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: (path: string) => ['jj-integration', 'thread', path] as const,
  workspaceSync: ['jj-integration', 'workspace-sync'] as const,
}
export const threadRebaseMutationKey = ['jj-integration', 'thread-rebase'] as const

/** The thread sidebar owns restarting DSH (with its confirmation dialog) and registers it as a palette action. */
const RESTART_ACTION_ID = '@dshfiles/thread-sidebar/action/restart-dsh'
const NO_PALETTE_CONTEXT: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }
const findRestartAction = () => getPaletteActions().find(action => action.id === RESTART_ACTION_ID) ?? null
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
  const restart = useSyncExternalStore(subscribePaletteActions, findRestartAction, noRestartAction)
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

const ThreadSessionRow = (props: {
  readonly session: SessionSummary
  readonly sessions: ISessions
  readonly t: JjIntegrationTranslate
  readonly openSession: (sessionId: SessionSummary['id']) => void
}): JSX.Element => {
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewId = useId()

  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="dshx:min-w-0 dshx:grow dshx:justify-start dshx:truncate dshx:px-2"
          title={props.session.displayTitle}
          aria-label={props.t('openThread', { title: props.session.displayTitle })}
          onClick={() => props.openSession(props.session.id)}
        >
          {props.session.displayTitle}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="dshx:shrink-0"
          aria-expanded={previewOpen}
          aria-controls={previewId}
          onClick={() => setPreviewOpen(open => !open)}
        >
          {props.t(previewOpen ? 'hidePreview' : 'preview')}
        </Button>
      </div>
      {previewOpen ? <SessionConversationPreview id={previewId} session={props.session} sessions={props.sessions} t={props.t} /> : null}
    </li>
  )
}

const ThreadRow = (props: {
  readonly thread: ThreadView
  readonly sessionById: ReadonlyMap<string, SessionSummary>
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly busy: boolean
  readonly onRebase: () => void
  readonly onDiscard: () => void
}): JSX.Element => {
  const { thread, t } = props
  const queryClient = useQueryClient()
  const subscribe = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readSessionRunning = useCallback(
    () => Object.values(props.sessions.list.getSnapshot().byId).some(session => session.cwd === thread.path && session.running),
    [props.sessions, thread.path],
  )
  const readClientCanRebase = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return canRebaseThread(thread.sessionIds, sessionId => {
      const session = sessions[SessionId(sessionId)]
      return session === undefined ? undefined : { running: session.running, pendingUserQuestion: hasPendingUserQuestion(session.projectionValues) }
    })
  }, [props.sessions, thread.sessionIds])
  const readClientQuestionPending = useCallback(() => {
    const sessions = props.sessions.list.getSnapshot().byId
    return (
      thread.sessionIds.some(sessionId => hasPendingUserQuestion(sessions[SessionId(sessionId)]?.projectionValues) === true) ||
      Object.values(sessions).some(session => session.cwd === thread.path && hasPendingUserQuestion(session.projectionValues) === true)
    )
  }, [props.sessions, thread.path, thread.sessionIds])
  const sessionRunning = useSyncExternalStore(subscribe, readSessionRunning, () => true)
  const clientCanRebase = useSyncExternalStore(subscribe, readClientCanRebase, () => false)
  const sessionWaitingForInput = useSyncExternalStore(subscribe, readClientQuestionPending, () => true)
  const canRebase = thread.canRebase === true && !sessionRunning && !sessionWaitingForInput
  const blockedReason = thread.canRebase === undefined ? t('rebaseActivityUnknown') : t('rebaseBlocked')
  useEffect(() => {
    if (thread.canRebase !== false || !clientCanRebase) return
    void queryClient.invalidateQueries({ queryKey: threadQueryKeys.repositories })
  }, [clientCanRebase, queryClient, thread.canRebase])
  const conflicted = thread.unlanded.some(revision => revision.conflict)
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:font-mono dshx:text-sm">{thread.name}</span>
        <Badge variant="secondary">{t('sessions', { count: thread.sessionIds.length })}</Badge>
        {thread.unlanded.length === 0 ? <Badge variant="outline">{t('upToDate')}</Badge> : <Badge>{t('toRebase', { count: thread.unlanded.length })}</Badge>}
        {thread.behind ? <Badge variant="outline">{t('behind', { bookmark: props.bookmark })}</Badge> : null}
        {thread.rebasedAt === undefined ? null : (
          <Badge variant="secondary" title={new Date(thread.rebasedAt).toLocaleString()}>
            {t('rebasedTag')}
          </Badge>
        )}
        {conflicted ? <Badge variant="destructive">{t('conflict')}</Badge> : null}
        {thread.finished ? <Badge variant="outline">{t('finished')}</Badge> : null}
        {thread.missing ? <Badge variant="destructive">{t('missing')}</Badge> : null}
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-2">
          {thread.unlanded.length > 0 ? (
            <Button size="sm" disabled={props.busy || thread.missing || !canRebase} onClick={props.onRebase} title={canRebase ? undefined : blockedReason}>
              {props.busy ? <Spinner /> : null}
              {props.busy ? t('rebasing') : t('rebase')}
            </Button>
          ) : null}
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
      {thread.sessionIds.length > 0 ? (
        <ul className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:border-l dshx:pl-2">
          {thread.sessionIds.map(sessionId => {
            const session = props.sessionById.get(sessionId)
            if (session === undefined)
              return (
                <li key={sessionId} className="dshx:truncate dshx:px-2 dshx:text-xs dshx:text-muted-foreground">
                  {sessionId}
                </li>
              )
            return <ThreadSessionRow key={session.id} session={session} sessions={props.sessions} t={t} openSession={props.openSession} />
          })}
        </ul>
      ) : null}
      {thread.unlanded.length > 0 ? (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs dshx:text-muted-foreground">
          {thread.unlanded.map(revision => (
            <li key={revision.commitId} className="dshx:truncate">
              <span className="dshx:font-mono">{revision.changeId}</span> {revision.description}
            </li>
          ))}
        </ul>
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

const useSessionDirectory = (sessions: ISessions): ReadonlyMap<string, SessionSummary> => {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const readSnapshot = useCallback(() => sessions.list.getSnapshot(), [sessions])
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  return useMemo(() => new Map<string, SessionSummary>(Object.values(snapshot.byId).map(session => [session.id, session])), [snapshot.byId])
}

export const ThreadWorkspacesPanel = (props: {
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
}): JSX.Element => {
  const { t } = props
  const sessionById = useSessionDirectory(props.sessions)
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
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path }, { signal }) }),
    onSuccess: async (result, path) => {
      if (result.status === 'landed') {
        await queryClient.cancelQueries({ queryKey: threadQueryKeys.repositories })
        queryClient.setQueryData<Awaited<ReturnType<typeof api.repositories>>>(threadQueryKeys.repositories, previous => {
          if (previous === undefined) return previous
          return {
            repositories: previous.repositories.map(repository => ({
              ...repository,
              threads: repository.threads.map(thread => (thread.path === path ? { ...thread, unlanded: [], behind: false } : thread)),
            })),
          }
        })
        setNotice(null)
        toast.show({ text: describeLandResult(t, result), success: true })
        return
      }
      setNotice({ tone: result.status === 'nothing-to-land' ? 'default' : 'destructive', text: describeLandResult(t, result) })
    },
    onError: error => setNotice({ tone: 'destructive', text: errorMessage(error, t('loadFailed')) }),
    onSettled: refreshAfterChange,
  })
  const discard = useDiscardConfirmation({
    client: {
      discard: (input, options) =>
        runHostRequest({ signal: options.signal, timeoutMs: 120_000, request: hostSignal => api.discard(input, { signal: hostSignal }) }),
    },
    onSettled: refreshAfterChange,
  })
  const repositoriesWithThreads = repositories.data?.repositories.filter(repository => repository.threads.length > 0)

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:p-6">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
          <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle', { bookmark: props.bookmark })}</p>
        </div>
        <Button className="dshx:ml-auto" size="sm" variant="outline" onClick={() => void repositories.refetch()} disabled={repositories.isFetching}>
          {repositories.isFetching ? <Spinner /> : <RefreshCwIcon />}
          {t('refresh')}
        </Button>
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
      {repositories.data !== undefined && repositories.data.repositories.length > 0 && repositoriesWithThreads?.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">{t('noThreads')}</p>
      ) : null}
      {repositoriesWithThreads?.map(repository => (
        <Card key={repository.repoRoot}>
          <CardHeader>
            <CardTitle>{repository.title}</CardTitle>
            <CardDescription className="dshx:break-all dshx:font-mono">{repository.repoRoot}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="dshx:flex dshx:flex-col dshx:gap-2">
              {repository.threads.map(thread => (
                <ThreadRow
                  key={thread.path}
                  thread={thread}
                  sessionById={sessionById}
                  sessions={props.sessions}
                  openSession={props.openSession}
                  t={t}
                  bookmark={props.bookmark}
                  busy={rebasesPending}
                  onRebase={() => rebase.mutate(thread.path)}
                  onDiscard={() => discard.request({ path: thread.path, name: thread.name, unlandedCount: thread.unlanded.length })}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      <DiscardDialog t={t} confirmation={discard} />
    </div>
  )
}
