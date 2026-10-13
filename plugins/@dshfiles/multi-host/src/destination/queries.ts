import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import { isApiError, type ApiClient } from '@dshfiles/dshx/api'
import { multiHostApi } from '../api.js'

export type MultiHostClient = ApiClient<(typeof multiHostApi)['methods']>

export const multiHostKeys = {
  all: ['multi-host'] as const,
  directory: ['multi-host', 'directory'] as const,
  status: (runtimeId: string) => ['multi-host', 'status', runtimeId] as const,
  models: (runtimeId: string) => ['multi-host', 'models', runtimeId] as const,
  browse: (runtimeId: string, path: string | undefined) => ['multi-host', 'browse', runtimeId, path ?? '~'] as const,
  transcript: (runtimeId: string, sessionId: string) => ['multi-host', 'transcript', runtimeId, sessionId] as const,
  threads: ['multi-host', 'threads'] as const,
  sshHosts: ['multi-host', 'ssh-hosts'] as const,
}

/** Without the multi-host plugin its routes do not exist, and the Connection reports that as an HTTP 404 transport failure. */
export const isMultiHostMissing = (error: unknown): boolean => isApiError(error) && error.kind === 'transport' && error.message.endsWith('HTTP 404')

export const multiHostQueries = {
  directory: (api: MultiHostClient, refetchInterval: number | false = false) =>
    queryOptions({
      queryKey: multiHostKeys.directory,
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.list(undefined, { signal: hostSignal }) }),
      refetchInterval: query => (isMultiHostMissing(query.state.error) ? false : refetchInterval),
      retry: false,
    }),
  /** Connects the host if needed, so it doubles as the status probe of the chip menu. */
  status: (api: MultiHostClient, runtimeId: string, refetchInterval: number | false) =>
    queryOptions({
      queryKey: multiHostKeys.status(runtimeId),
      queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 40_000, request: hostSignal => api.runtimeStatus({ runtimeId }, { signal: hostSignal }) }),
      refetchInterval,
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
