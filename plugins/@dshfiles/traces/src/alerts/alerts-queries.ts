import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { retryOnceUnlessTimedOut, runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { queryOptions, resourceQueryOptions } from '@dshfiles/plugin-ui/query'
import type { tracesAlertsApi } from './alerts-api.js'

export type AlertsClient = typeof tracesAlertsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const alertsKeys = {
  all: ['traces', 'alerts'] as const,
  state: ['traces', 'alerts', 'state'] as const,
  feed: ['traces', 'alerts', 'feed'] as const,
}

const STATE_POLL_MS = 10_000
const FEED_POLL_MS = 15_000

/** A Host that predates alerts answers owner-missing until it restarts: stop polling instead of retrying it. */
export const alertsOwnerMissing = (error: unknown): boolean => error instanceof Error && isApiOwnerMissing(error)

const pollUnlessMissing =
  (intervalMs: number) =>
  (query: { readonly state: { readonly error: unknown } }): number | false =>
    alertsOwnerMissing(query.state.error) ? false : intervalMs

export const alertsQueries = {
  state: (client: AlertsClient) =>
    queryOptions({
      queryKey: alertsKeys.state,
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.state({ historyLimit: 50 }, { signal: hostSignal }) }),
      refetchInterval: pollUnlessMissing(STATE_POLL_MS),
      retry: (failures, error) => !alertsOwnerMissing(error) && retryOnceUnlessTimedOut(failures, error),
    }),
  /** Read through the page-wide resource store, so the badge, the panel and the notifier share one read per id. */
  feed: (client: AlertsClient, afterId: number | null) =>
    queryOptions({
      ...resourceQueryOptions({ queryKey: [...alertsKeys.feed, afterId] as const, client, method: 'feed', input: { afterId } }),
      refetchInterval: pollUnlessMissing(FEED_POLL_MS),
      retry: false,
    }),
}
