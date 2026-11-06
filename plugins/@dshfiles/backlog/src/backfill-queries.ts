import { queryOptions } from '@dshfiles/plugin-ui/query'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'

import type { BacklogBackfillResult, backlogApi } from './api.js'
import { BacklogQueries } from './use-backlog-actions.js'

export type BacklogClient = typeof backlogApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const backfillStatusQueries = {
  /** One key per job, so a second backfill never inherits the first one's poll. */
  key: (jobId: string | null) => [BacklogQueries.key, 'backfill-status', jobId] as const,
  /**
   * A queued or running job is followed every second; a read that failed backs off to five, and settles at either end
   * of that scale: a finished job and a job this Host no longer holds both stop the poll.
   */
  pollInterval: (snapshot: { readonly status: 'pending' | 'error' | 'success'; readonly data?: BacklogBackfillResult | null | undefined }): number | false => {
    if (snapshot.status === 'error') return 5_000
    const data = snapshot.data
    if (data === null || data === undefined) return false
    return data.state === 'queued' || data.state === 'running' ? 1_000 : false
  },
  /** The mutation's answer seeds the key, so the first poll can wait its interval instead of asking again at once. */
  status: (input: { readonly client: BacklogClient; readonly jobId: string | null }) =>
    queryOptions({
      queryKey: backfillStatusQueries.key(input.jobId),
      queryFn: ({ signal }) => (input.jobId === null ? Promise.resolve(null) : input.client.backfillTriageStatus({ jobId: input.jobId }, { signal })),
      enabled: input.jobId !== null,
      refetchInterval: snapshot => backfillStatusQueries.pollInterval({ status: snapshot.state.status, data: snapshot.state.data }),
      retry: false,
    }),
}
