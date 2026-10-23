import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@dshfiles/plugin-ui/query'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import type { ListInput, LogsInput, tracesApi } from './api.js'
import type { LogList, TraceList } from './types.js'

export type TracesClient = typeof tracesApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const tracesKeys = {
  all: ['traces'] as const,
  status: ['traces', 'status'] as const,
  list: (filters: Omit<ListInput, 'cursor'>) => ['traces', 'list', filters] as const,
  trace: (traceId: string) => ['traces', 'trace', traceId] as const,
  logs: (filters: Omit<LogsInput, 'cursor'>) => ['traces', 'logs', filters] as const,
  stats: (windowMinutes: number) => ['traces', 'stats', windowMinutes] as const,
  errors: (windowMinutes: number) => ['traces', 'errors', windowMinutes] as const,
  serviceMap: (windowMinutes: number) => ['traces', 'service-map', windowMinutes] as const,
  sessionSummary: (sessionId: string) => ['traces', 'session-summary', sessionId] as const,
  metrics: (windowMinutes: number, search: string) => ['traces', 'metrics', windowMinutes, search] as const,
  metric: (input: { readonly name: string; readonly service: string; readonly windowMinutes: number }) => ['traces', 'metric', input] as const,
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
  logs: (client: TracesClient, filters: Omit<LogsInput, 'cursor'>) =>
    infiniteQueryOptions<LogList, Error, InfiniteData<LogList, string | null>, ReturnType<typeof tracesKeys.logs>, string | null>({
      queryKey: tracesKeys.logs(filters),
      initialPageParam: null,
      queryFn: ({ signal, pageParam }) =>
        runHostRequest({
          signal,
          request: hostSignal => client.logs(pageParam === null ? filters : { ...filters, cursor: pageParam }, { signal: hostSignal }),
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
  metrics: (client: TracesClient, windowMinutes: number, search: string) =>
    queryOptions({
      queryKey: tracesKeys.metrics(windowMinutes, search),
      queryFn: ({ signal }) =>
        runHostRequest({
          signal,
          request: hostSignal => client.metrics(search.length === 0 ? { windowMinutes } : { windowMinutes, search }, { signal: hostSignal }),
        }),
      refetchInterval: POLL_MS * 2,
      retry: 1,
    }),
  metric: (client: TracesClient, input: { readonly name: string; readonly service: string; readonly windowMinutes: number }) =>
    queryOptions({
      queryKey: tracesKeys.metric(input),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.metric({ ...input }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS * 2,
      retry: false,
    }),
  serviceMap: (client: TracesClient, windowMinutes: number) =>
    queryOptions({
      queryKey: tracesKeys.serviceMap(windowMinutes),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.serviceMap({ windowMinutes }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS * 2,
      retry: 1,
    }),
  sessionSummary: (client: TracesClient, sessionId: string) =>
    queryOptions({
      queryKey: tracesKeys.sessionSummary(sessionId),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.sessionSummary({ sessionId }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS,
      retry: false,
    }),
  errors: (client: TracesClient, windowMinutes: number) =>
    queryOptions({
      queryKey: tracesKeys.errors(windowMinutes),
      queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => client.errors({ windowMinutes, limit: 100 }, { signal: hostSignal }) }),
      refetchInterval: POLL_MS * 2,
      retry: 1,
    }),
}
