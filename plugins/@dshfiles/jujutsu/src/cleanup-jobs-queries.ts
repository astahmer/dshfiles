import { isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type CleanupJobView, type CleanupKindView, type CleanupResult, type CleanupTarget } from '@dshfiles/jj-integration/api'
import { queryOptions, useQuery } from '@dshfiles/plugin-ui/query'

export type JjIntegrationClient = ApiClient<(typeof jjIntegrationApi)['methods']>

export const cleanupJobsKey = ['jujutsu', 'cleanup-jobs'] as const

/** A removal deletes node_modules trees; one poll a second keeps the counts honest without drowning the Host. */
const CLEANUP_POLL_MS = 1_000
/** A removal started from another window or an agent tool still shows up, without a one-second poll while idle. */
const CLEANUP_IDLE_POLL_MS = 15_000

/** The removal trail, newest first: the running job and the last one that settled. */
export const useCleanupJobs = () => {
  const api = useApi(jjIntegrationApi)
  return useQuery(
    queryOptions({
      queryKey: cleanupJobsKey,
      queryFn: ({ signal }) => api.cleanupJobs({}, { signal }),
      refetchInterval: query => (query.state.data?.jobs.some(CleanupJobTrailModel.isActive) === true ? CLEANUP_POLL_MS : CLEANUP_IDLE_POLL_MS),
      retry: false,
    }),
  )
}

/** Labels and summaries for the trail; the Hook above owns the query, these own how a job reads. */
export class CleanupJobTrailModel {
  static readonly isActive = (job: CleanupJobView): boolean => job.state === 'queued' || job.state === 'running'

  static readonly phaseLabel = (job: CleanupJobView): string => {
    if (job.state === 'queued') return 'Waiting for the removal already running'
    if (job.phase === 'scanning') return 'Looking for idle workspaces'
    if (job.phase === 'removing') return 'Removing thread workspaces'
    if (job.phase === 'abandoning') return 'Abandoning empty revisions'
    return job.state === 'failed' ? 'Cleanup failed' : 'Cleanup finished'
  }

  static readonly progressLabel = (job: CleanupJobView): string =>
    job.progress.total === 0 ? '' : `${String(job.progress.processed)}/${String(job.progress.total)}`

  /** What a finished job did, from its rows when the newest job carries them and from its counts otherwise. */
  static readonly summary = (job: CleanupJobView): string => {
    if (job.state === 'failed') return job.error ?? 'The cleanup stopped without saying why.'
    if (job.state !== 'done') return CleanupJobTrailModel.phaseLabel(job)
    const removedWorkspaces = job.result === null ? job.progress.removed : job.result.workspaces.filter(row => row.outcome === 'removed').length
    const removedUntracked = job.result?.untracked.filter(row => row.outcome === 'removed').length ?? 0
    const abandoned = job.result?.emptyRevisions.length ?? 0
    const firstFailure =
      job.result?.workspaces.find(row => row.outcome === 'failed')?.message ?? job.result?.untracked.find(row => row.outcome === 'failed')?.message
    return [
      removedWorkspaces === 0 ? undefined : `${String(removedWorkspaces)} thread workspaces removed`,
      removedUntracked === 0 ? undefined : `${String(removedUntracked)} untracked folder${removedUntracked === 1 ? '' : 's'} removed`,
      abandoned === 0 ? undefined : `${String(abandoned)} empty revision${abandoned === 1 ? '' : 's'} abandoned`,
      job.progress.kept === 0 ? undefined : `${String(job.progress.kept)} kept`,
      job.progress.failed === 0 ? undefined : `${String(job.progress.failed)} failed${firstFailure === undefined ? '' : ` (${firstFailure})`}`,
    ]
      .filter(part => part !== undefined)
      .join(' · ')
  }
}

export interface CleanupRequest {
  readonly path: string
  readonly olderThanHours: number
  readonly kinds: readonly CleanupKindView[]
  readonly targets?: readonly CleanupTarget[]
}

/** The two verbs a click needs, so a fake client proves both paths without the whole API surface. */
export interface CleanupStartClient {
  readonly startCleanup: (input: {
    readonly path: string
    readonly olderThanHours: number
    readonly kinds: CleanupKindView[]
    readonly targets?: CleanupTarget[]
  }) => Promise<{ readonly job: CleanupJobView }>
  readonly cleanupWorkspaces: (input: {
    readonly path: string
    readonly olderThanHours: number
    readonly kinds: CleanupKindView[]
    readonly targets?: CleanupTarget[]
    readonly apply: boolean
  }) => Promise<CleanupResult>
}

/**
 * Starts the removal without waiting for it. A Host that predates the background verb only removes in the request that
 * asked, so fall back to that and let the trail-less panel wait instead of failing the click.
 */
export const requestWorkspaceCleanup = async (api: CleanupStartClient, request: CleanupRequest): Promise<void> => {
  const { targets, ...scope } = request
  const targetSelection = targets === undefined ? {} : { targets: [...targets] }
  try {
    await api.startCleanup({ ...scope, kinds: [...scope.kinds], ...targetSelection })
  } catch (error) {
    const failure = error instanceof Error ? error : undefined
    const unknownMethod = failure !== undefined && /Unknown API method/u.test(failure.message)
    if (!isApiOwnerMissing(failure) && !unknownMethod) throw error
    if (request.targets !== undefined) throw new Error('This DSH Host cannot remove a selected subset. Restart DSH to load the updated cleanup API.')
    await api.cleanupWorkspaces({ ...scope, kinds: [...scope.kinds], ...targetSelection, apply: true })
  }
}
