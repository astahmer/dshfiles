import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { jjIntegrationApi, type LandResult, type ThreadView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: (path: string) => ['jj-integration', 'thread', path] as const,
}

export const describeLandResult = (t: JjIntegrationTranslate, result: LandResult): string => {
  const summary =
    result.status === 'landed'
      ? t('landed', { count: result.revisions.length, bookmark: result.bookmark })
      : result.status === 'nothing-to-land'
        ? t('nothingToLand', { bookmark: result.bookmark })
        : result.status === 'needs-description'
          ? t('needsDescription', { revisions: result.revisions.map(revision => revision.changeId).join(', ') })
          : t('conflicted', { bookmark: result.bookmark, files: result.files.join(', ') })
  return result.agentAsked ? `${summary} ${t('agentAsked')}` : summary
}

const ThreadRow = (props: {
  readonly thread: ThreadView
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly busy: boolean
  readonly onLand: () => void
  readonly onDiscard: (force: boolean) => void
}): JSX.Element => {
  const { thread, t } = props
  const conflicted = thread.unlanded.some(revision => revision.conflict)
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:font-mono dshx:text-sm">{thread.name}</span>
        <Badge variant="secondary">{t('sessions', { count: thread.sessionIds.length })}</Badge>
        {thread.unlanded.length === 0 ? (
          <Badge variant="outline">{t('upToDate')}</Badge>
        ) : (
          <Badge>{t('unlanded', { count: thread.unlanded.length })}</Badge>
        )}
        {thread.behind ? <Badge variant="outline">{t('behind', { bookmark: props.bookmark })}</Badge> : null}
        {conflicted ? <Badge variant="destructive">{t('conflict')}</Badge> : null}
        {thread.finished ? <Badge variant="outline">{t('finished')}</Badge> : null}
        {thread.missing ? <Badge variant="destructive">{t('missing')}</Badge> : null}
        <span className="dshx:ml-auto dshx:flex dshx:gap-2">
          <Button size="sm" disabled={props.busy || thread.missing} onClick={props.onLand}>
            {props.busy ? t('landing') : t('land')}
          </Button>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onDiscard(false)}>
            {t('discard')}
          </Button>
          {thread.unlanded.length > 0 ? (
            <Button size="sm" variant="destructive" disabled={props.busy} onClick={() => props.onDiscard(true)}>
              {t('discardWork')}
            </Button>
          ) : null}
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

export const ThreadWorkspacesPanel = (props: { readonly t: JjIntegrationTranslate; readonly bookmark: string }): JSX.Element => {
  const { t } = props
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<{ readonly tone: 'default' | 'destructive'; readonly text: string } | null>(null)
  const repositories = useQuery({
    queryKey: threadQueryKeys.repositories,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => api.repositories({}, { signal: hostSignal }) }),
  })
  const action = useMutation({
    mutationFn: (request: ({ readonly kind: 'land' } | { readonly kind: 'discard'; readonly force: boolean }) & { readonly path: string }) =>
      request.kind === 'land'
        ? runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path: request.path }, { signal }) }).then(result => ({
            tone: result.status === 'landed' || result.status === 'nothing-to-land' ? ('default' as const) : ('destructive' as const),
            text: describeLandResult(t, result),
          }))
        : runHostRequest({ timeoutMs: 120_000, request: signal => api.discard({ path: request.path, force: request.force }, { signal }) }).then(result =>
            result.status === 'has-work' ? { tone: 'destructive' as const, text: t('hasWork') } : null,
          ),
    onSuccess: next => setNotice(next),
    onError: error => setNotice({ tone: 'destructive', text: errorMessage(error, t('loadFailed')) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['jj-integration'] }),
  })

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
      {notice === null ? null : (
        <Alert variant={notice.tone}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {repositories.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(repositories.error, t('loadFailed'))}
          </AlertDescription>
        </Alert>
      ) : null}
      {repositories.data?.repositories.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noRepositories')}</p> : null}
      {repositories.data?.repositories.map(repository => (
        <Card key={repository.repoRoot}>
          <CardHeader>
            <CardTitle>{repository.title}</CardTitle>
            <CardDescription className="dshx:font-mono">{repository.repoRoot}</CardDescription>
          </CardHeader>
          <CardContent>
            {repository.threads.length === 0 ? (
              <p className="dshx:text-sm dshx:text-muted-foreground">{t('noThreads')}</p>
            ) : (
              <ul className="dshx:flex dshx:flex-col dshx:gap-2">
                {repository.threads.map(thread => (
                  <ThreadRow
                    key={thread.path}
                    thread={thread}
                    t={t}
                    bookmark={props.bookmark}
                    busy={action.isPending && action.variables?.path === thread.path}
                    onLand={() => action.mutate({ kind: 'land', path: thread.path })}
                    onDiscard={force => action.mutate({ kind: 'discard', force, path: thread.path })}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
