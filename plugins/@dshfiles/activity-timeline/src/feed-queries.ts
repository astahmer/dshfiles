import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { infiniteQueryOptions, type InfiniteData } from '@dshfiles/plugin-ui/query'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'

import type { activityTimelineApi } from './api.js'
import type { ActivityLevel, ActivityPage, ActivitySource } from './types.js'

export type ActivityFeedClient = typeof activityTimelineApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

/** The feed's filter as the panel keeps it; the query key is its only form, so a filter change starts paging over. */
export type ActivityFeedFilter = {
  readonly search: string
  readonly sources: readonly ActivitySource[]
  readonly attentionOnly: boolean
  readonly detailed: boolean
}

const attentionLevels: readonly ActivityLevel[] = ['attention']

/** A stable empty page list, so the merge memo holds while the first read is still in flight. */
export const NO_PAGES: readonly ActivityPage[] = []

export const activityFeedKeys = {
  filter: (filter: ActivityFeedFilter) => [filter.search, [...filter.sources].sort().join(','), filter.attentionOnly, filter.detailed] as const,
  feed: (filter: ActivityFeedFilter) => ['activity-timeline', 'feed', ...activityFeedKeys.filter(filter)] as const,
}

export const activityFeedQueries = {
  /** dshx API payloads refuse undefined values, so an absent filter is omitted rather than sent as undefined. */
  pageInput: (input: { readonly filter: ActivityFeedFilter; readonly cursor: string | null; readonly limit: number }) => ({
    ...(input.filter.search.length !== 0 && { search: input.filter.search }),
    ...(input.filter.sources.length !== 0 && { sources: [...input.filter.sources] }),
    ...(input.filter.attentionOnly && { levels: [...attentionLevels] }),
    detailed: input.filter.detailed,
    limit: input.limit,
    ...(input.cursor !== null && { cursor: input.cursor }),
  }),
  /**
   * The first page is the live tail the panel polls; every later page is older history it loads on demand. Both live in
   * one infinite query keyed by the filter, so a filter change drops the old pages with the key instead of a reset effect.
   */
  feed: (input: { readonly client: ActivityFeedClient; readonly filter: ActivityFeedFilter; readonly limit: number }) =>
    infiniteQueryOptions<ActivityPage, Error, InfiniteData<ActivityPage, string | null>, ReturnType<typeof activityFeedKeys.feed>, string | null>({
      queryKey: activityFeedKeys.feed(input.filter),
      initialPageParam: null,
      queryFn: ({ signal, pageParam }) =>
        runHostRequest({
          signal,
          request: hostSignal =>
            input.client.page(activityFeedQueries.pageInput({ filter: input.filter, cursor: pageParam, limit: input.limit }), { signal: hostSignal }),
        }),
      getNextPageParam: page => page.nextCursor,
      refetchInterval: 5_000,
      retry: 1,
    }),
  /** The tail the panel auto-scrolls for, and the older history it keeps above it. */
  items: (pages: readonly ActivityPage[]) => ({
    newest: pages[0]?.items ?? [],
    older: pages.slice(1).flatMap(page => page.items),
  }),
}
