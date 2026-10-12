import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Separator } from '@dshfiles/plugin-ui/components/ui/separator'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronDownIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { jjIntegrationApi, type IntegrationOverview } from './api.js'
import { runHostRequest } from './host-request.js'
import type { JjIntegrationTranslate } from './locales.js'
import type { IntegrationCandidate, WorkspaceRecord } from './types.js'

const overviewKey = ['jj-integration', 'overview'] as const

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneDot: Record<Tone, string> = {
  neutral: 'dshx:bg-muted-foreground/60',
  success: 'dshx:bg-success',
  warning: 'dshx:bg-warning',
  danger: 'dshx:bg-destructive',
  info: 'dshx:bg-info',
}

interface ChipStatus {
  readonly label: string
  readonly tone: Tone
}

const candidateStateLabel = (state: IntegrationCandidate['state'], t: JjIntegrationTranslate): string =>
  state === 'running'
    ? t('runningState')
    : state === 'already-integrated'
      ? t('alreadyIntegratedState')
      : state === 'stale'
        ? t('staleState')
        : state === 'integrated'
          ? t('integrated')
          : state === 'cancelled'
            ? t('cancelled')
            : state === 'blocked'
              ? t('blocked')
              : state === 'failed'
                ? t('failed')
                : t('queued')

/** Only the states a thread can act on are named; everything else reads as writable. */
export const describeStatus = (
  workspace: WorkspaceRecord,
  candidate: IntegrationCandidate | undefined,
  sessionId: string,
  t: JjIntegrationTranslate,
): ChipStatus => {
  if (workspace.missing) return { label: t('missing'), tone: 'danger' }
  if (candidate?.state === 'blocked' || candidate?.state === 'failed' || candidate?.state === 'stale') {
    return { label: t('chipNeedsResolution'), tone: 'danger' }
  }
  if (candidate?.state === 'running') return { label: t('chipIntegrating'), tone: 'info' }
  if (candidate?.state === 'queued' || workspace.lifecycle === 'ready' || workspace.lifecycle === 'integrating') {
    return { label: t('chipIntegrationPending'), tone: 'warning' }
  }
  const lease = workspace.writerLease
  if (lease === null || lease.sessionId === sessionId) return { label: t('chipWritable'), tone: 'success' }
  if (workspace.observers.some(observer => observer.sessionId === sessionId)) return { label: t('chipReadOnly'), tone: 'neutral' }
  return { label: t('chipOwnedElsewhere'), tone: 'danger' }
}

/**
 * Compact composer status for the thread's own workspace, in the composer's
 * existing leading control row so it costs no extra height. Every value comes
 * from the authoritative Host registry through the existing remote; the chip
 * keeps no state of its own beyond the open popover and a pending action.
 */
export const WorkspaceStatusChip = (props: {
  readonly sessionId: string
  readonly t: JjIntegrationTranslate
  readonly onOpen: () => void
}): JSX.Element | null => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [failed, setFailed] = useState<string | null>(null)
  const overviewQuery = useQuery({
    queryKey: overviewKey,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.overview({}, { signal: hostSignal }) }),
    refetchInterval: 10_000,
    retry: 1,
  })
  const after = async (): Promise<void> => {
    setFailed(null)
    await queryClient.invalidateQueries({ queryKey: overviewKey })
  }
  const claim = useMutation({
    mutationFn: (workspaceId: string) => api.acquireWriter({ workspaceId, sessionId: props.sessionId }),
    onSuccess: after,
    onError: error => setFailed(errorMessage(error, t('actionFailed'))),
  })
  const request = useMutation({
    mutationFn: async (workspaceId: string) => {
      await api.markReady({ workspaceId })
      return api.submit({ workspaceId, sessionId: props.sessionId })
    },
    onSuccess: after,
    onError: error => setFailed(errorMessage(error, t('actionFailed'))),
  })
  const release = useMutation({
    mutationFn: (workspaceId: string) => api.releaseWriter({ workspaceId, sessionId: props.sessionId }),
    onSuccess: after,
    onError: error => setFailed(errorMessage(error, t('actionFailed'))),
  })

  const overview: IntegrationOverview | undefined = overviewQuery.data
  if (overview === undefined) return null
  const workspace = overview.workspaces.find(item => item.owners.some(owner => owner.sessionId === props.sessionId && owner.detachedAt === null))
  if (workspace === undefined) return null
  const repository = overview.repositories.find(item => item.id === workspace.repositoryId)
  const repositoryName = repository?.root.split('/').filter(Boolean).slice(-1)[0] ?? workspace.name
  const candidate = overview.candidates.find(item => item.workspaceId === workspace.id && item.state !== 'cancelled' && item.state !== 'integrated')
  const status = describeStatus(workspace, candidate, props.sessionId, t)
  const owned = workspace.writerLease?.sessionId === props.sessionId
  const busy = claim.isPending || request.isPending || release.isPending
  const writerLabel =
    workspace.writerLease === null
      ? t('chipWriterNone')
      : workspace.writerLease.sessionId === props.sessionId
        ? t('chipWriterYou')
        : t('chipWriterOther')
  const candidateLabel = candidate === undefined ? t('chipNotRequested') : candidateStateLabel(candidate.state, t)

  return (
    <Popover onOpenChange={open => (open ? undefined : setFailed(null))}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('chipDetails')}
          className="dshx:h-6 dshx:max-w-[22rem] dshx:gap-1.5 dshx:rounded-md dshx:px-1.5 dshx:text-[11px] dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground"
        >
          <span className={cn('dshx:size-1.5 dshx:shrink-0 dshx:rounded-full', toneDot[status.tone])} aria-hidden />
          <span className="dshx:min-w-0 dshx:truncate">
            <span className="dshx:font-mono">{repositoryName}</span>
            <span className="dshx:mx-1 dshx:opacity-50">/</span>
            <span className="dshx:font-mono">{workspace.name}</span>
          </span>
          <span className="dshx:shrink-0 dshx:opacity-50">·</span>
          <span className="dshx:shrink-0">{status.label}</span>
          <ChevronDownIcon className="dshx:size-3 dshx:shrink-0 dshx:opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="dshx:w-[22rem] dshx:p-3 dshx:text-xs">
        <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-2">
          <div className="dshx:min-w-0">
            <p className="dshx:truncate dshx:font-mono dshx:text-sm">{workspace.name}</p>
            <p className="dshx:truncate dshx:text-muted-foreground">{repository?.root ?? workspace.path}</p>
          </div>
          <Badge variant={workspace.isolated ? 'secondary' : 'outline'} className="dshx:shrink-0">
            {workspace.isolated ? t('chipIsolated') : t('chipShared')}
          </Badge>
        </div>
        <Separator className="dshx:my-3" />
        <dl className="dshx:grid dshx:grid-cols-[6.5rem_minmax(0,1fr)] dshx:items-baseline dshx:gap-x-2 dshx:gap-y-1.5">
          <dt className="dshx:text-muted-foreground">{t('chipWriter')}</dt>
          <dd className="dshx:min-w-0">{writerLabel}</dd>
          <dt className="dshx:text-muted-foreground">{t('lifecycle')}</dt>
          <dd className="dshx:min-w-0">{t(workspace.lifecycle === 'integrated' ? 'integratedLifecycle' : workspace.lifecycle)}</dd>
          <dt className="dshx:text-muted-foreground">{t('chipIntegration')}</dt>
          <dd className="dshx:min-w-0">{candidateLabel}</dd>
          <dt className="dshx:text-muted-foreground">{t('chipPath')}</dt>
          <dd className="dshx:min-w-0 dshx:truncate dshx:font-mono" title={workspace.path}>
            {workspace.path}
          </dd>
        </dl>
        {workspace.isolated ? null : <p className="dshx:mt-3 dshx:text-muted-foreground">{t('chipShared')}</p>}
        {failed === null ? null : <p className="dshx:mt-3 dshx:text-destructive">{failed}</p>}
        <Separator className="dshx:my-3" />
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
          {!owned && workspace.writerLease !== null ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => claim.mutate(workspace.id)}>
              {t('chipClaim')}
            </Button>
          ) : null}
          {owned && candidate === undefined ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => request.mutate(workspace.id)}>
              {t('chipRequestIntegration')}
            </Button>
          ) : null}
          {owned ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => release.mutate(workspace.id)}>
              {t('chipRelease')}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={props.onOpen}>
            {t('chipOpen')}
          </Button>
          {overviewQuery.isError ? (
            <Button type="button" size="sm" variant="ghost" disabled={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()}>
              {overviewQuery.isFetching ? <Spinner className="dshx:size-3" /> : <RefreshCwIcon className="dshx:size-3" aria-hidden />} {t('chipRetry')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
