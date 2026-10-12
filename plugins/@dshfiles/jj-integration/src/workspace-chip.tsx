import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { jjIntegrationApi, type IntegrationOverview } from './api.js'
import { runHostRequest } from './host-request.js'
import type { JjIntegrationTranslate } from './locales.js'
import type { IntegrationCandidate, WorkspaceRecord } from './types.js'

const overviewKey = ['jj-integration', 'overview'] as const

type ChipStatus = { readonly label: string; readonly variant: 'default' | 'secondary' | 'destructive' | 'outline' }

const describeStatus = (
  workspace: WorkspaceRecord,
  candidate: IntegrationCandidate | undefined,
  sessionId: string,
  t: JjIntegrationTranslate,
): ChipStatus => {
  if (candidate?.state === 'blocked' || candidate?.state === 'failed') return { label: t('chipNeedsResolution'), variant: 'destructive' }
  if (candidate?.state === 'running') return { label: t('chipIntegrating'), variant: 'default' }
  if (candidate?.state === 'queued' || workspace.lifecycle === 'ready' || workspace.lifecycle === 'integrating') {
    return { label: t('chipIntegrationPending'), variant: 'secondary' }
  }
  const lease = workspace.writerLease
  if (lease === null) return { label: t('chipWritable'), variant: 'outline' }
  if (lease.sessionId === sessionId) return { label: t('chipWritable'), variant: 'default' }
  if (workspace.observers.some(observer => observer.sessionId === sessionId)) return { label: t('chipReadOnly'), variant: 'outline' }
  return { label: t('chipOwnedElsewhere'), variant: 'destructive' }
}

/**
 * Compact composer status for the thread's own workspace. Every value comes from
 * the authoritative Host registry through the existing remote; the chip keeps no
 * state of its own beyond the pending action.
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
    onError: error => setFailed(errorMessage(error, t('loadFailed'))),
  })
  const request = useMutation({
    mutationFn: async (workspaceId: string) => {
      await api.markReady({ workspaceId })
      return api.submit({ workspaceId, sessionId: props.sessionId })
    },
    onSuccess: after,
    onError: error => setFailed(errorMessage(error, t('loadFailed'))),
  })
  const release = useMutation({
    mutationFn: (workspaceId: string) => api.releaseWriter({ workspaceId, sessionId: props.sessionId }),
    onSuccess: after,
    onError: error => setFailed(errorMessage(error, t('loadFailed'))),
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

  return (
    <div className="dshx-root dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
      <Badge variant="outline" className="dshx:font-mono dshx:text-[11px]">
        {repositoryName} / {workspace.name}
      </Badge>
      <Badge variant={status.variant} className="dshx:text-[11px]">
        {status.label}
      </Badge>
      {!owned && workspace.writerLease !== null ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => claim.mutate(workspace.id)}>
          {t('chipClaim')}
        </Button>
      ) : null}
      {owned && candidate === undefined ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => request.mutate(workspace.id)}>
          {t('chipRequestIntegration')}
        </Button>
      ) : null}
      {owned ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => release.mutate(workspace.id)}>
          {t('chipRelease')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={props.onOpen}>
        {t('chipOpen')}
      </Button>
      {failed === null ? null : <span className="dshx:text-[11px] dshx:text-destructive">{failed}</span>}
    </div>
  )
}
