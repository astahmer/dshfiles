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
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState, useSyncExternalStore } from 'react'
import { jjIntegrationApi, type ThreadView, type WorkspaceSyncView } from './api.js'
import { useDiscardConfirmation } from './discard-machine.js'
import { announceRepositoryChange, describeLandResult, useLandToast } from './land-feedback.js'
import type { JjIntegrationTranslate } from './locales.js'

export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: (path: string) => ['jj-integration', 'thread', path] as const,
  workspaceSync: ['jj-integration', 'workspace-sync'] as const,
}

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

/** What the background sync after the last Land did to the checkout running DSH, with the restart it may need. */
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

const ThreadRow = (props: {
  readonly thread: ThreadView
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly busy: boolean
  readonly onLand: () => void
  readonly onDiscard: () => void
}): JSX.Element => {
  const { thread, t } = props
  const conflicted = thread.unlanded.some(revision => revision.conflict)
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:font-mono dshx:text-sm">{thread.name}</span>
        <Badge variant="secondary">{t('sessions', { count: thread.sessionIds.length })}</Badge>
        {thread.unlanded.length === 0 ? <Badge variant="outline">{t('upToDate')}</Badge> : <Badge>{t('unlanded', { count: thread.unlanded.length })}</Badge>}
        {thread.behind ? <Badge variant="outline">{t('behind', { bookmark: props.bookmark })}</Badge> : null}
        {conflicted ? <Badge variant="destructive">{t('conflict')}</Badge> : null}
        {thread.finished ? <Badge variant="outline">{t('finished')}</Badge> : null}
        {thread.missing ? <Badge variant="destructive">{t('missing')}</Badge> : null}
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-2">
          {thread.unlanded.length > 0 ? (
            <Button size="sm" disabled={props.busy || thread.missing} onClick={props.onLand}>
              {props.busy ? <Spinner /> : null}
              {props.busy ? t('landing') : t('land')}
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
                {thread.unlanded.length > 0 ? t('discardWork') : t('discard')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
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
                ? t('discardWithWorkTitle', { name: target.name, count: target.unlandedCount })
                : t('discardTitle', { name: target.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target !== null && target.unlandedCount > 0 ? t('discardWithWorkDescription', { count: target.unlandedCount }) : t('discardDescription')}
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
              {target !== null && target.unlandedCount > 0 ? t('discardWork') : t('discard')}
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

export const ThreadWorkspacesPanel = (props: { readonly t: JjIntegrationTranslate; readonly bookmark: string }): JSX.Element => {
  const { t } = props
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const toast = useLandToast()
  const [notice, setNotice] = useState<{ readonly tone: 'default' | 'destructive'; readonly text: string } | null>(null)
  const repositories = useQuery({
    queryKey: threadQueryKeys.repositories,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => api.repositories({}, { signal: hostSignal }) }),
  })
  const refreshAfterChange = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['jj-integration'] })
    announceRepositoryChange()
  }
  const land = useMutation({
    mutationFn: (path: string) => runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path }, { signal }) }),
    onSuccess: result => {
      if (result.status === 'landed') {
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
      <header className="dshx:flex dshx:items-start dshx:gap-3">
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
            <CardDescription className="dshx:font-mono">{repository.repoRoot}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="dshx:flex dshx:flex-col dshx:gap-2">
              {repository.threads.map(thread => (
                <ThreadRow
                  key={thread.path}
                  thread={thread}
                  t={t}
                  bookmark={props.bookmark}
                  busy={land.isPending && land.variables === thread.path}
                  onLand={() => land.mutate(thread.path)}
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
