import type { GraphNavigation } from './api.js'
import { JUJUTSU_QUERY_GC_TIME } from './repository-query-cache.js'

/**
 * Landmarks are read once per repository snapshot the panel shows: `refreshedAt` is the state query's update time.
 * The key sits outside the `['jujutsu', root]` prefix and never goes stale on its own, so a repository invalidation
 * (the panel coming back into view, another plugin's rebase) reaches landmarks only through the state refetch that
 * follows it, not as a second read of the snapshot it is about to replace.
 */
const options = (input: {
  readonly root: string
  readonly repoId: string | null
  readonly refreshedAt: number
  readonly onScreen: boolean
  readonly read: (repoId: string, signal: AbortSignal) => Promise<GraphNavigation>
}) => ({
  queryKey: ['jujutsu-landmarks', input.root, input.repoId, input.refreshedAt] as const,
  queryFn: ({ signal }: { readonly signal: AbortSignal }) => input.read(input.repoId ?? '', signal),
  enabled: input.repoId !== null && input.onScreen && input.refreshedAt > 0,
  retry: false,
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: JUJUTSU_QUERY_GC_TIME,
  refetchOnWindowFocus: false,
})

export const GraphLandmarksQuery = { options }
