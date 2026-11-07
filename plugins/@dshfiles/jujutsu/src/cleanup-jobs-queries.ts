import { isApiError, isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type CleanupJobView, type CleanupKindView, type CleanupResult, type CleanupTarget } from '@dshfiles/jj-integration/api'
import { queryOptions, useQuery } from '@dshfiles/plugin-ui/query'

export type JjIntegrationClient = ApiClient<(typeof jjIntegrationApi)['methods']>

export const cleanupJobsKey = ['jujutsu', 'cleanup-jobs'] as const

/** A removal deletes node_modules trees; one poll a second keeps the counts honest without drowning the Host. */
const CLEANUP_POLL_MS = 1_000
/** A removal started from another window or an agent tool still shows up, without a one-second poll while idle. */
const CLEANUP_IDLE_POLL_MS = 15_000

export interface CleanupJobsClient {
  readonly cleanupJobs: (
    input: { readonly path?: string },
    options: { readonly signal: AbortSignal },
  ) => Promise<{ readonly repoRoot?: string | null | undefined; readonly jobs: readonly CleanupJobView[] }>
}

/**
 * Reads one project's trail when `path` is given (the Host traces a thread workspace to its project), the whole trail
 * otherwise. A Host from before the filter rejects the field as a contract error: only then does the reader fall back
 * to the whole trail, as that Host always showed, and stop asking for the filter until the page reloads (the Host only
 * changes with a restart). Any other failure, a timeout or a Host error, is the query's to report and retry.
 */
export const createCleanupJobsReader = (
  options: {
    /** Whether a failure is the Host refusing the `path` field; tests stand in for dshx's private ApiError brand. */
    readonly isRefusal?: (error: unknown) => boolean
  } = {},
) => {
  const isRefusal = options.isRefusal ?? ((error: unknown) => isApiError(error) && error.kind === 'contract')
  let pathFilterRefused = false
  return async (api: CleanupJobsClient, path: string | undefined, signal: AbortSignal) => {
    if (path === undefined || pathFilterRefused) return api.cleanupJobs({}, { signal })
    try {
      return await api.cleanupJobs({ path }, { signal })
    } catch (error) {
      if (!isRefusal(error)) throw error
      pathFilterRefused = true
      return api.cleanupJobs({}, { signal })
    }
  }
}

const readCleanupJobs = createCleanupJobsReader()

/** The removal trail, newest first: the running job and the last one that settled; one project's when `path` is given. */
export const useCleanupJobs = (path?: string) => {
  const api = useApi(jjIntegrationApi)
  return useQuery(
    queryOptions({
      queryKey: [...cleanupJobsKey, path ?? null],
      queryFn: ({ signal }) => readCleanupJobs(api, path, signal),
      refetchInterval: query => (query.state.data?.jobs.some(CleanupJobTrailModel.isActive) === true ? CLEANUP_POLL_MS : CLEANUP_IDLE_POLL_MS),
      retry: false,
    }),
  )
}

/** Labels and summaries for the trail; the Hook above owns the query, these own how a job reads. */
export class CleanupJobTrailModel {
  static readonly isActive = (job: CleanupJobView): boolean => job.state === 'queued' || job.state === 'running'

  /** The job stopped, or finished leaving a workspace or folder it could not remove. */
  static readonly hasFailure = (job: CleanupJobView): boolean => job.state === 'failed' || (job.state === 'done' && job.progress.failed > 0)

  /** What to do next about a failure: the Host's recovery, or the same guarded rerun from a Host that predates it. */
  static readonly recovery = (job: CleanupJobView): string | null => {
    if (!CleanupJobTrailModel.hasFailure(job)) return null
    return (
      job.recovery ??
      'Fix what the error names, then run Clean up thread workspaces… again: its preview rechecks every workspace and never forces unlanded work.'
    )
  }

  /**
   * A failure in two short parts: what stayed (the headline names the workspace, never a path that truncates first) and
   * why, as the Host reported it.
   */
  static readonly failure = (job: CleanupJobView): { readonly headline: string; readonly reason: string | null } | null => {
    if (job.state === 'failed') return { headline: 'Cleanup failed', reason: job.error ?? 'The cleanup stopped without saying why.' }
    if (!CleanupJobTrailModel.hasFailure(job)) return null
    const rows = [...(job.result?.workspaces ?? []), ...(job.result?.untracked ?? [])].filter(row => row.outcome === 'failed')
    const first = rows[0]
    if (first === undefined)
      return { headline: `Could not remove ${String(job.progress.failed)} workspace${job.progress.failed === 1 ? '' : 's'}`, reason: null }
    const others = rows.length === 1 ? '' : ` and ${String(rows.length - 1)} more`
    return { headline: `Could not remove ${first.name}${others}`, reason: first.message ?? null }
  }

  /** A job id restarts with the Host, so a dismissal remembers when the job started too. */
  static readonly dismissKey = (job: CleanupJobView): string => `${job.id}@${String(job.startedAt)}`

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
