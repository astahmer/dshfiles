import { keepPreviousData, QueryClient } from '@tanstack/query-core'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

export * from '@tanstack/react-query'
export { keepPreviousData }

let pluginQueryClientInstance: QueryClient | undefined

/**
 * One client per plugin bundle: dshx inlines this module into each plugin's
 * chunk, so every slot of a plugin shares a cache and no two plugins do.
 * Host calls are local RPC, so a failure is rarely transient — retry once,
 * and leave focus refetching off because the Host pushes its own updates.
 */
export const pluginQueryClient = (): QueryClient => {
  pluginQueryClientInstance ??= new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
      mutations: { retry: false },
    },
  })
  return pluginQueryClientInstance
}

export const PluginQueryProvider = (props: { readonly client?: QueryClient; readonly children: ReactNode }): JSX.Element => (
  <QueryClientProvider client={props.client ?? pluginQueryClient()}>{props.children}</QueryClientProvider>
)

/** Readable message for a failed query or mutation, without leaking non-Error values. */
export const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message.length > 0 ? error.message : fallback)
