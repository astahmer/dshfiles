import { apiResource, resourceStore, type ApiResourceOptions } from '@dshfiles/dshx/client'
import type { AnyApiMethodDefinition, ApiClient, ApiClientInput, ApiClientOutput } from '@dshfiles/dshx/api'
import { keepPreviousData, QueryClient } from '@tanstack/query-core'
import { QueryClientProvider, queryOptions, type QueryKey } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { HostConnection } from './lib/host-connection.js'
import { retryOnceUnlessTimedOut } from './lib/host-request.js'

export * from '@tanstack/react-query'
export { keepPreviousData }

let pluginQueryClientInstance: QueryClient | undefined

/**
 * One client per plugin bundle: dshx inlines this module into each plugin's
 * chunk, so every slot of a plugin shares a cache and no two plugins do.
 * Host calls are local RPC, so a failure is rarely transient — retry once, never after a client timeout,
 * and leave focus refetching off because the Host pushes its own updates.
 * Thirty seconds of staleness keeps a remounting panel from re-reading what it
 * already has; mutations invalidate their keys and live views poll explicitly.
 * A minute of garbage collection is deliberate: the default five minutes kept every
 * Session-keyed read resident, and a tab that opened twenty threads held ~133 MB of
 * per-Session data that only ever expired after the full window.
 */
export const PLUGIN_QUERY_GC_MS = 60_000

export const pluginQueryClient = (): QueryClient => {
  pluginQueryClientInstance ??= new QueryClient({
    defaultOptions: {
      queries: { retry: retryOnceUnlessTimedOut, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: PLUGIN_QUERY_GC_MS },
      mutations: { retry: false },
    },
  })
  return pluginQueryClientInstance
}

/**
 * One watcher per client, however many providers share it (every slot of a bundle mounts one): when DSH answers again
 * after `reconnecting` or `offline` (lib/host-connection), the client invalidates its queries once, so open views
 * refetch what they missed without a reload.
 */
const connectionWatchers = new WeakMap<QueryClient, { holders: number; readonly stop: () => void }>()

const watchHostConnection = (client: QueryClient): (() => void) => {
  const existing = connectionWatchers.get(client)
  if (existing !== undefined) existing.holders += 1
  else {
    const stop = HostConnection.subscribe(state => {
      if (state === 'online') void client.invalidateQueries()
    })
    connectionWatchers.set(client, { holders: 1, stop })
  }
  return () => {
    const watcher = connectionWatchers.get(client)
    if (watcher === undefined) return
    watcher.holders -= 1
    if (watcher.holders > 0) return
    watcher.stop()
    connectionWatchers.delete(client)
  }
}

export const PluginQueryProvider = (props: { readonly client?: QueryClient; readonly children: ReactNode }): JSX.Element => {
  const client = props.client ?? pluginQueryClient()
  useEffect(() => watchHostConnection(client), [client])
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

/**
 * TanStack options whose `queryFn` reads through the page-wide dshx resource store, so a `useQuery` site shares one
 * cached read with every other bundle reading the same method and input. Polling and retries stay on the query; move
 * the site to `useResource` to let the store own the poll.
 */
export const resourceQueryOptions = <const Methods extends Record<string, AnyApiMethodDefinition>, K extends keyof Methods & string>(input: {
  readonly queryKey: QueryKey
  readonly client: ApiClient<Methods>
  readonly method: K
  readonly input?: ApiClientInput<Methods[K]>
  readonly resource?: ApiResourceOptions<ApiClientOutput<Methods[K]>>
}) => {
  const key = apiResource({
    client: input.client,
    method: input.method,
    ...(input.input !== undefined && { input: input.input }),
    ...(input.resource !== undefined && { options: input.resource }),
  })
  return queryOptions({
    queryKey: input.queryKey,
    queryFn: ({ signal }) => resourceStore().ensure<ApiClientOutput<Methods[K]>>(key, { signal }),
  })
}

/** Readable message for a failed query or mutation, without leaking non-Error values. */
export const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message.length > 0 ? error.message : fallback)
