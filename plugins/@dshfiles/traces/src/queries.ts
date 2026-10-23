import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@dshfiles/plugin-ui/query'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import type { ListInput, tracesApi } from './api.js'
import type { TraceList } from './types.js'

export type TracesClient = typeof tracesApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const tracesKeys = {
  all: ['traces'] as const,
  status: ['traces', 'status'] as const,
  list: (filters: Omit<ListInput, 'cursor'>) => ['traces', 'list', filters] as const,
  trace: (traceId: string) => ['traces', 'trace', traceId] as const,
  stats: (windowMinutes: number) => ['traces', 'stats', windowMinutes] as const,
  errors: (windowMinutes: number) => ['traces', 'errors', windowMinutes] as const,
}

const POLL_MS = 5_000

export const tracesQueries = {
  status: (client: TracesClient) =>
    queryOptions({
      queryKey: tracesKeys.status,
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.status({}, { signal: hostSignal }) }),
      refetchInterval: POLL_MS,
      retry: 1,
    }),
  list: (client: TracesClient, filters: Omit<ListInput, 'cursor'>) =>
    infiniteQueryOptions<TraceList, Error, InfiniteData<TraceList, string | null>, ReturnType<typeof tracesKeys.list>, string | null>({
      queryKey: tracesKeys.list(filters),
      initialPageParam: null,
      queryFn: ({ signal, pageParam }) =>
        runHostRequest({
          signal,
          request: hostSignal => client.list(pageParam === null ? filters : { ...filters, cursor: pageParam }, { signal: hostSignal }),
        }),
      getNextPageParam: page => page.nextCursor,
      refetchInterval: POLL_MS,
      retry: 1,
    }),
  trace: (client: TracesClient, traceId: string) =>
    queryOptions({
      queryKey: tracesKeys.trace(traceId),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.trace({ traceId }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS,
      retry: false,
    }),
  stats: (client: TracesClient, windowMinutes: number) =>
    queryOptions({
      queryKey: tracesKeys.stats(windowMinutes),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.stats({ windowMinutes, limit: 100 }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS * 2,
      retry: 1,
    }),
  errors: (client: TracesClient, windowMinutes: number) =>
    queryOptions({
      queryKey: tracesKeys.errors(windowMinutes),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.errors({ windowMinutes, limit: 100 }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS * 2,
      retry: 1,
    }),
}
