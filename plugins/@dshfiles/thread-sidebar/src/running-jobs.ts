import { backgroundJobsApi, RunningThreads } from '@dshfiles/background-jobs/running-threads'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'

const RUNNING_JOBS_POLL_MS = 5_000
const NO_JOBS: ReadonlyMap<string, number> = new Map()

/** How many running background jobs each thread owns, from the board's running rows. */
const countsOf = (rows: readonly { readonly owner: string | null }[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const row of rows) if (row.owner !== null) counts.set(row.owner, (counts.get(row.owner) ?? 0) + 1)
  return counts
}

/**
 * Running background jobs per thread, for the row's muted "1 job" chip. A job never makes its thread Working (a dev
 * server would pin it there for hours, DESIGN.md R2); the row only says it runs. Polls while the list is ready and stops
 * for good when the Host has no background-jobs plugin.
 */
const useCounts = (enabled: boolean): ReadonlyMap<string, number> => {
  const api = useApi(backgroundJobsApi)
  const query = useQuery({
    queryKey: ['thread-sidebar', 'running-jobs'],
    queryFn: async ({ signal }) => countsOf((await api.board({ scope: 'running', limit: RunningThreads.limit }, { signal })).rows),
    enabled,
    retry: false,
    refetchInterval: current => (isApiOwnerMissing(current.state.error) ? false : RUNNING_JOBS_POLL_MS),
    refetchIntervalInBackground: false,
  })
  return query.data ?? NO_JOBS
}

export const RunningJobsModel = { countsOf, useCounts }
