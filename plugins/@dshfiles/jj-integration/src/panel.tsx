import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import type { IntegrationCandidate, IntegrationEvent, WorkspaceRecord } from './types.js'
import { useState } from 'react'
import { jjIntegrationApi, type CandidateDetail, type IntegrationOverview } from './api.js'
import { runHostRequest } from './host-request.js'
import type { JjIntegrationTranslate } from './locales.js'

const overviewKey = ['jj-integration', 'overview'] as const
const eventsKey = ['jj-integration', 'events'] as const
const detailKey = ['jj-integration', 'detail'] as const

type PendingAction = { readonly kind: 'run' | 'cancel'; readonly candidateId: string } | null
type Mode = IntegrationOverview['modes']['isolation']

const shortRevision = (revision: { readonly changeId: string } | null): string => (revision === null ? '—' : revision.changeId.slice(0, 8))

const formatTime = (value: number): string => new Date(value).toLocaleString()

const modeLabel = (mode: Mode, t: JjIntegrationTranslate): string =>
  mode === 'auto' ? t('modeAuto') : mode === 'manual' ? t('modeManual') : t('modeOff')

const modeVariant = (mode: Mode): 'secondary' | 'outline' | 'destructive' => (mode === 'off' ? 'destructive' : mode === 'auto' ? 'secondary' : 'outline')

const stateVariant = (state: IntegrationCandidate['state']): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (state === 'blocked' || state === 'failed' || state === 'stale') return 'destructive'
  if (state === 'integrated' || state === 'already-integrated') return 'default'
  if (state === 'running') return 'secondary'
  return 'outline'
}

/** Why a candidate is not moving, in the order the coordinator resolves them. */
export const blockerOf = (candidate: IntegrationCandidate): string | null => {
  if (candidate.conflict !== null) return `${candidate.conflict.files.length} conflicting file(s)`
  if (candidate.validation.kind === 'command' && candidate.validation.exitCode !== null && candidate.validation.exitCode !== 0) return 'validation failed'
  if (candidate.dependsOn.length > 0) return `${candidate.dependsOn.length} dependency candidate(s)`
  if (candidate.error !== null) return candidate.error
  if (candidate.state === 'stale') return 'source revision moved after queueing'
  return null
}

const CandidateRow = (props: {
  readonly candidate: IntegrationCandidate
  readonly workspaceName: string
  readonly busy: boolean
  readonly pending: PendingAction
  readonly t: JjIntegrationTranslate
  readonly onInspect: (candidateId: string) => void
  readonly onRun: (candidateId: string) => void
  readonly onCancel: (candidateId: string) => void
  readonly onRetry: (candidateId: string) => void
  readonly onMove: (candidateId: string, direction: 'up' | 'down') => void
  readonly onRequestAction: (action: PendingAction) => void
}): JSX.Element => {
  const t = props.t
  const candidate = props.candidate
  const actionable = candidate.state === 'queued' || candidate.state === 'stale' || candidate.state === 'blocked' || candidate.state === 'failed'
  const blocker = blockerOf(candidate)
  return (
    <div className="dshx:rounded-lg dshx:border dshx:border-border dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-2">
        <div className="dshx:min-w-0">
          <p className="dshx:break-words dshx:text-sm dshx:font-semibold">{candidate.sourceRevision.description.length === 0 ? candidate.id.slice(0, 8) : candidate.sourceRevision.description}</p>
          <p className="dshx:mt-1 dshx:break-all dshx:text-xs dshx:text-muted-foreground">
            {t('workspace')}: {props.workspaceName} · {t('revision')}: {shortRevision(candidate.sourceRevision)} · {t('session')}: {candidate.sourceSessionId?.slice(0, 8) ?? '—'}
          </p>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Badge variant={stateVariant(candidate.state)}>{t(candidate.state === 'running' ? 'runningState' : candidate.state === 'already-integrated' ? 'alreadyIntegratedState' : candidate.state === 'stale' ? 'staleState' : candidate.state)}</Badge>
          {candidate.conflict === null ? null : <Badge variant="destructive">{t('conflicts')}: {candidate.conflict.files.length}</Badge>}
          {candidate.validation.kind === 'command' ? (
            <Badge variant={candidate.validation.exitCode === 0 ? 'secondary' : 'destructive'}>
              {candidate.validation.exitCode === 0 ? t('validationPassed') : t('validationFailed')}
            </Badge>
          ) : null}
          {candidate.dependsOn.length === 0 ? null : <Badge variant="outline">{t('dependencies')}: {candidate.dependsOn.length}</Badge>}
        </div>
      </div>
      {blocker === null ? null : <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">{t('blocked')}: {blocker}</p>}
      <div className="dshx:mt-3 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Button size="sm" variant="outline" onClick={() => props.onInspect(candidate.id)}>{t('source')}</Button>
        {actionable ? (
          props.pending?.candidateId === candidate.id && props.pending.kind === 'run' ? (
            <>
              <Button size="sm" disabled={props.busy} onClick={() => props.onRun(candidate.id)}>{t('confirmRun')}</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onRequestAction(null)}>{t('cancel')}</Button>
            </>
          ) : (
            <Button size="sm" disabled={props.busy || candidate.state === 'stale'} onClick={() => props.onRequestAction({ kind: 'run', candidateId: candidate.id })}>
              {candidate.state === 'running' ? t('running') : t('run')}
            </Button>
          )
        ) : null}
        {candidate.state === 'blocked' || candidate.state === 'failed' || candidate.state === 'stale' || candidate.state === 'cancelled' ? (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onRetry(candidate.id)}>{t('retry')}</Button>
        ) : null}
        {actionable ? (
          props.pending?.candidateId === candidate.id && props.pending.kind === 'cancel' ? (
            <Button size="sm" variant="destructive" disabled={props.busy} onClick={() => props.onCancel(candidate.id)}>{t('confirmCancel')}</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onRequestAction({ kind: 'cancel', candidateId: candidate.id })}>{t('cancel')}</Button>
          )
        ) : null}
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onMove(candidate.id, 'up')}>{t('moveUp')}</Button>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onMove(candidate.id, 'down')}>{t('moveDown')}</Button>
      </div>
    </div>
  )
}

const DetailPanel = (props: { readonly detail: CandidateDetail; readonly t: JjIntegrationTranslate }): JSX.Element => {
  const t = props.t
  const detail = props.detail
  return (
    <Card>
      <CardHeader>
        <CardTitle className="dshx:text-base">{detail.candidate.sourceRevision.description.length === 0 ? detail.candidate.id.slice(0, 8) : detail.candidate.sourceRevision.description}</CardTitle>
        <CardDescription>
          {t('spine')}: {shortRevision(detail.candidate.spineAtSubmit)} · {t('changedFiles')}: {detail.changedFiles.length}
        </CardDescription>
      </CardHeader>
      <CardContent className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
        {detail.alreadyIntegrated ? <Badge variant="default">{t('alreadyIntegrated')}</Badge> : null}
        {detail.sourceStale ? <Badge variant="destructive">{t('stale')}</Badge> : null}
        {detail.sourceMissing ? <Badge variant="destructive">{t('missing')}</Badge> : null}
        <p className="dshx:text-xs dshx:text-muted-foreground">{t('dependencies')}: {detail.dependencies.length === 0 ? '—' : detail.dependencies.map(dependency => `${dependency.id.slice(0, 8)}:${dependency.state}`).join(', ')}</p>
        <p className="dshx:text-xs dshx:text-muted-foreground">{t('overlap')}: {detail.overlappingFiles.length === 0 ? t('noOverlap') : detail.overlappingFiles.slice(0, 8).join(', ')}</p>
        {detail.candidate.conflict === null ? null : (
          <>
            <Separator />
            <p className="dshx:text-xs dshx:font-semibold dshx:text-destructive">{t('conflicts')}</p>
            <p className="dshx:break-all dshx:text-xs">{detail.candidate.conflict.files.slice(0, 12).join(', ') || '—'}</p>
            <p className="dshx:text-xs dshx:text-muted-foreground">{detail.candidate.conflict.note}</p>
          </>
        )}
        {detail.candidate.validation.kind === 'command' ? (
          <>
            <Separator />
            <p className="dshx:text-xs dshx:font-semibold">{t('validation')}</p>
            <p className="dshx:text-xs dshx:text-muted-foreground">{detail.candidate.validation.command} → {detail.candidate.validation.exitCode}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

const WorkspaceRow = (props: {
  readonly workspace: WorkspaceRecord
  readonly busy: boolean
  readonly t: JjIntegrationTranslate
  readonly onReady: (workspaceId: string) => void
}): JSX.Element => {
  const { workspace, t } = props
  const writer = workspace.writerLease
  const ready = workspace.lifecycle === 'ready' || workspace.lifecycle === 'integrating'
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3">
      <div className="dshx:min-w-0 dshx:flex-1">
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <p className="dshx:font-mono dshx:text-sm dshx:font-semibold">{workspace.name}</p>
          <Badge variant={workspace.isolated ? 'secondary' : 'outline'}>{workspace.isolated ? t('isolatedWorkspace') : t('sharedWorkspace')}</Badge>
          {workspace.missing ? <Badge variant="destructive">{t('missing')}</Badge> : null}
        </div>
        <p className="dshx:mt-1 dshx:break-all dshx:text-xs dshx:text-muted-foreground" title={workspace.path}>
          {workspace.path}
        </p>
        <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">
          {t('currentRevision')}: {shortRevision(workspace.currentRevision)} · {t('chipWriter')}:{' '}
          {writer === null ? t('unclaimed') : <span className="dshx:font-mono">{writer.sessionId.slice(0, 8)}</span>} · {t('observers')}: {workspace.observers.length} ·{' '}
          {t('owners')}: {workspace.owners.filter(owner => owner.detachedAt === null).length}
        </p>
      </div>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <Badge variant="outline">{t(workspace.lifecycle === 'integrated' ? 'integratedLifecycle' : workspace.lifecycle)}</Badge>
        <Button size="sm" variant="outline" disabled={props.busy || ready || workspace.missing} onClick={() => props.onReady(workspace.id)}>
          {ready ? t('ready') : t('markReady')}
        </Button>
      </div>
    </div>
  )
}

export const JjIntegrationPanel = (props: { readonly t: JjIntegrationTranslate }): JSX.Element => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const overviewQuery = useQuery({
    queryKey: overviewKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.overview({}, { signal: hostSignal }) }),
    refetchInterval: 15_000,
    retry: 1,
  })
  const eventsQuery = useQuery({
    queryKey: eventsKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.events({ limit: 100 }, { signal: hostSignal }) }),
    refetchInterval: 30_000,
    retry: 1,
  })
  const detailQuery = useQuery({
    queryKey: [...detailKey, selectedCandidateId],
    enabled: selectedCandidateId !== null,
    queryFn: ({ signal }) => {
      if (selectedCandidateId === null) throw new Error('Select a candidate first.')
      return runHostRequest({ signal, request: hostSignal => api.inspect({ candidateId: selectedCandidateId }, { signal: hostSignal }) })
    },
    retry: false,
  })
  /** Retry everything the panel shows, so Refresh is a real recovery action. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      overviewQuery.refetch(),
      eventsQuery.refetch(),
      selectedCandidateId === null ? Promise.resolve() : detailQuery.refetch(),
    ])
  }
  const actionMutation = useMutation({
    mutationFn: (request: { readonly kind: 'run' | 'cancel' | 'retry' | 'move' | 'ready'; readonly candidateId?: string; readonly workspaceId?: string; readonly direction?: 'up' | 'down' }) =>
      runHostRequest({
        request: async signal => {
          if (request.kind === 'run' && request.candidateId !== undefined) return api.run({ candidateId: request.candidateId }, { signal })
          if (request.kind === 'cancel' && request.candidateId !== undefined) return api.cancel({ candidateId: request.candidateId }, { signal })
          if (request.kind === 'retry' && request.candidateId !== undefined) return api.retry({ candidateId: request.candidateId }, { signal })
          if (request.kind === 'move' && request.candidateId !== undefined) return api.move({ candidateId: request.candidateId, direction: request.direction ?? 'up' }, { signal })
          if (request.kind === 'ready' && request.workspaceId !== undefined) return api.markReady({ workspaceId: request.workspaceId }, { signal })
          throw new Error('Unsupported integration action.')
        },
      }),
    onSuccess: async () => {
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: overviewKey })
      await queryClient.invalidateQueries({ queryKey: eventsKey })
      if (selectedCandidateId !== null) await queryClient.invalidateQueries({ queryKey: [...detailKey, selectedCandidateId] })
    },
  })
  const overview = overviewQuery.data
  const workspaceNames = new Map((overview?.workspaces ?? []).map(workspace => [workspace.id, workspace.name]))
  const candidates = overview?.candidates ?? []
  const busy = actionMutation.isPending
  const detail = detailQuery.data
  const hasData = overview !== undefined
  const stale = hasData && overviewQuery.isError
  const failed = overviewQuery.isError && !hasData
  const refreshing = overviewQuery.isFetching || eventsQuery.isFetching

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:p-3 dshx:sm:p-5">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
        <div className="dshx:min-w-0">
          <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
          <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Badge variant={failed ? 'destructive' : stale ? 'outline' : 'secondary'}>
            {overviewQuery.isPending && !hasData ? t('loading') : failed ? t('unavailable') : stale ? t('staleData') : t('connected')}
          </Badge>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Spinner className="dshx:size-3" /> : <RefreshCwIcon aria-hidden />} {t('refresh')}
          </Button>
        </div>
      </header>

      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>{t('neverLoaded')}</AlertTitle>
          <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-2">
            <span>{errorMessage(overviewQuery.error, t('loadFailed'))}</span>
            <Button variant="outline" size="sm" className="dshx:self-start" disabled={refreshing} onClick={() => void refresh()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {stale ? (
        <Alert>
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
            <span>
              {t('staleData')} · {t('lastUpdated')} {formatTime(overviewQuery.dataUpdatedAt)} · {errorMessage(overviewQuery.error, t('loadFailed'))}
            </span>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {actionMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(actionMutation.error, t('actionFailed'))}</AlertDescription>
        </Alert>
      )}

      {overview === undefined ? null : (
        <>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
            <span className="dshx:text-muted-foreground">{t('isolationAutomation')}</span>
            <Badge variant={modeVariant(overview.modes.isolation)}>{modeLabel(overview.modes.isolation, t)}</Badge>
            <span className="dshx:text-muted-foreground">{t('integrationAutomation')}</span>
            <Badge variant={modeVariant(overview.modes.integration)}>{modeLabel(overview.modes.integration, t)}</Badge>
            <span className="dshx:text-muted-foreground">
              {overview.modes.integration === 'auto' ? t('modeIntegrationAuto') : overview.modes.integration === 'manual' ? t('modeIntegrationManual') : t('modeIntegrationOff')}
            </span>
          </div>
          <Tabs defaultValue="queue">
            <TabsList>
              <TabsTrigger value="queue">{t('queue')} ({candidates.filter(candidate => candidate.state === 'queued' || candidate.state === 'running').length})</TabsTrigger>
              <TabsTrigger value="workspaces">{t('workspaces')} ({overview.workspaces.length})</TabsTrigger>
              <TabsTrigger value="history">{t('history')}</TabsTrigger>
            </TabsList>
            <TabsContent value="queue">
              <div className="dshx:grid dshx:gap-3 dshx:xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
                  {candidates.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noCandidates')}</p> : null}
                  {candidates.map(candidate => (
                    <CandidateRow
                      key={candidate.id}
                      candidate={candidate}
                      workspaceName={workspaceNames.get(candidate.workspaceId) ?? candidate.workspaceId.slice(0, 8)}
                      busy={busy}
                      pending={pending}
                      t={t}
                      onInspect={setSelectedCandidateId}
                      onRun={candidateId => actionMutation.mutate({ kind: 'run', candidateId })}
                      onCancel={candidateId => actionMutation.mutate({ kind: 'cancel', candidateId })}
                      onRetry={candidateId => actionMutation.mutate({ kind: 'retry', candidateId })}
                      onMove={(candidateId, direction) => actionMutation.mutate({ kind: 'move', candidateId, direction })}
                      onRequestAction={setPending}
                    />
                  ))}
                </div>
                <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
                  {detailQuery.isPending && selectedCandidateId !== null ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('loading')}</p> : null}
                  {detailQuery.error === null ? null : (
                    <Alert variant="destructive"><AlertDescription>{errorMessage(detailQuery.error, t('loadFailed'))}</AlertDescription></Alert>
                  )}
                  {detail === undefined ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('unverified')}</p> : <DetailPanel detail={detail} t={t} />}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="workspaces">
              <div className="dshx:flex dshx:flex-col dshx:gap-2">
                {overview.workspaces.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noWorkspaces')}</p> : null}
                {overview.workspaces.map(workspace => (
                  <WorkspaceRow
                    key={workspace.id}
                    workspace={workspace}
                    busy={busy}
                    t={t}
                    onReady={workspaceId => actionMutation.mutate({ kind: 'ready', workspaceId })}
                  />
                ))}
              </div>
            </TabsContent>
            <TabsContent value="history">
              <div className="dshx:flex dshx:flex-col dshx:gap-2">
                {(eventsQuery.data?.events ?? []).length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noEvents')}</p> : null}
                {(eventsQuery.data?.events ?? []).map((event: IntegrationEvent) => (
                  <div key={event.id} className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-2 dshx:text-xs">
                    <span className="dshx:font-medium">{event.type}</span>
                    <span className="dshx:text-muted-foreground">{event.detail ?? event.outcome ?? ''}</span>
                    <span className="dshx:text-muted-foreground">{formatTime(event.at)}</span>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
