import type { ApiClient } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect } from 'react'
import { jjIntegrationApi, type ProjectBookmarkView } from './api.js'

/** Every project-bookmark read shares this prefix, so a changed choice refreshes them all at once. */
const root = ['jj-integration', 'project-bookmark'] as const

const key = (path: string) => [...root, path] as const

/**
 * Each plugin bundle keeps its own query client, so invalidating one never reaches the project-bookmark reads Jujutsu or
 * Changes made: a saved choice is announced on the window, and every reader refreshes its own copy.
 */
const CHANGED_EVENT = 'dshfiles:project-bookmark-changed'

const announceChange = (): void => {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
}

/** The one read of a project's main branch, shared by the Settings panel and every `useProjectBookmark*` caller. */
const options = (input: { readonly api: Pick<ApiClient<typeof jjIntegrationApi.methods>, 'projectBookmark'>; readonly path: string }) => ({
  queryKey: key(input.path),
  enabled: input.path.length > 0,
  // An older Host has no `projectBookmark` method: one failed read, then every caller keeps its fallback.
  retry: false,
  staleTime: 30_000,
  queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
    runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => input.api.projectBookmark({ path: input.path }, { signal: hostSignal }) }),
})

/** The one bookmark every listed repository lands on, else the global fallback: headings name a single target. */
const shared = (input: { readonly repositories: readonly { readonly bookmark?: string | undefined }[]; readonly fallback: string }): string => {
  const names = new Set(input.repositories.map(repository => repository.bookmark ?? input.fallback))
  const [only] = names
  return names.size === 1 && only !== undefined ? only : input.fallback
}

/** Query keys, options and the change signal for a project's main branch, for readers outside the hooks below. */
export class ProjectBookmarkQuery {
  static readonly root = root
  static readonly key = key
  static readonly options = options
  static readonly announceChange = announceChange
  static readonly shared = shared
  static readonly changedEvent = CHANGED_EVENT
}

/**
 * How the Host resolved the main branch of the project holding `path`, with the layer that chose it; undefined while it
 * loads, outside a repository, or on a Host older than the per-project setting.
 */
export const useProjectBookmarkQuery = (path: string | null | undefined) => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = (): void => void queryClient.invalidateQueries({ queryKey: root })
    window.addEventListener(CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CHANGED_EVENT, refresh)
  }, [queryClient])
  return useQuery(options({ api, path: path ?? '' }))
}

export const useProjectBookmarkResolution = (path: string | null | undefined): ProjectBookmarkView | undefined => useProjectBookmarkQuery(path).data

/** The main branch of the project holding `path`; `fallback` (the global setting) until the Host names one. */
export const useProjectBookmark = (path: string | null | undefined, fallback: string): string => useProjectBookmarkResolution(path)?.bookmark ?? fallback
