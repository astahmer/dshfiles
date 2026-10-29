import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import { isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import { multiHostApi } from '../api.js'
import { runtimeStatusRefreshRefetchInterval } from '../runtime-status-refresh-policy.js'

export type MultiHostClient = ApiClient<(typeof multiHostApi)['methods']>

export const multiHostKeys = {
  all: ['multi-host'] as const,
  directory: ['multi-host', 'directory'] as const,
  resourcePool: ['multi-host', 'resource-pool'] as const,
  status: (runtimeId: string) => ['multi-host', 'status', runtimeId] as const,
  models: (runtimeId: string) => ['multi-host', 'models', runtimeId] as const,
  browse: (runtimeId: string, path: string | undefined) => ['multi-host', 'browse', runtimeId, path ?? '~'] as const,
  transcript: (runtimeId: string, sessionId: string) => ['multi-host', 'transcript', runtimeId, sessionId] as const,
  threads: ['multi-host', 'threads'] as const,
  sshHosts: ['multi-host', 'ssh-hosts'] as const,
}

export const multiHostQueries = {
  directory: (api: MultiHostClient, refetchInterval: number | false = false) =>
    queryOptions({
      queryKey: multiHostKeys.directory,
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.list(undefined, { signal: hostSignal }) }),
      refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : refetchInterval),
      retry: false,
    }),
  resourcePool: (api: MultiHostClient, refetchInterval: number | false = false) =>
    queryOptions({
      queryKey: multiHostKeys.resourcePool,
      queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 10_000, request: hostSignal => api.resourcePool(undefined, { signal: hostSignal }) }),
      staleTime: 5_000,
      refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : refetchInterval),
      retry: false,
    }),
  /** Connects the host if needed, so it doubles as the status probe of the chip menu. */
  status: (api: MultiHostClient, runtimeId: string, refetchInterval: number | false) =>
    queryOptions({
      queryKey: multiHostKeys.status(runtimeId),
      queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 40_000, request: hostSignal => api.runtimeStatus({ runtimeId }, { signal: hostSignal }) }),
      staleTime: 15_000,
      refetchInterval: query => {
        const status = query.state.data
        return runtimeStatusRefreshRefetchInterval({
          intervalMs: isApiOwnerMissing(query.state.error) ? false : refetchInterval,
          refreshing: status?.refreshing === true,
          available: status === undefined ? undefined : status.ok === false && status.refreshing !== true ? false : true,
        })
      },
      retry: false,
    }),
  models: (api: MultiHostClient, runtimeId: string) =>
    queryOptions({
      queryKey: multiHostKeys.models(runtimeId),
      queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 40_000, request: hostSignal => api.runtimeModels({ runtimeId }, { signal: hostSignal }) }),
      staleTime: 5 * 60_000,
      retry: false,
    }),
}
