import type { CommunicationMessagePage } from '@dshfiles/dshx/communication'
import { infiniteQueryOptions, queryOptions } from '@dshfiles/plugin-ui/query'

interface MessagePage {
  readonly items: readonly { readonly id: string }[]
  readonly nextCursor: string | null
}

interface MessageQueryInput<Page extends MessagePage> {
  readonly queryKey: readonly unknown[]
  readonly enabled: boolean
  readonly browse: (beforeId: string | null, signal: AbortSignal) => Promise<Page>
}

export class MessagePages {
  /** The live head is the only thing on a timer; loaded older pages stay stable until a mutation invalidates them. */
  static readonly headRefreshIntervalMs = 30_000

  /**
   * Older pages load on demand and never poll. A periodic refetch on an infinite query costs one request per loaded
   * page, so browsing twenty pages would turn every thirty seconds into twenty RPCs.
   */
  static readonly historyOptions = <Page extends MessagePage>(input: MessageQueryInput<Page>) =>
    infiniteQueryOptions({
      queryKey: [...input.queryKey],
      enabled: input.enabled,
      // SAFETY: the first page carries no cursor; the param type widens so later pages can pass one.
      initialPageParam: null as string | null,
      queryFn: ({ pageParam, signal }) => input.browse(pageParam, signal),
      getNextPageParam: page => page.nextCursor ?? undefined,
      refetchInterval: false,
      retry: false,
    })

  /** The head polls alone, so a periodic refresh costs one request however many older pages were browsed. */
  static readonly headOptions = <Page extends MessagePage>(
    input: MessageQueryInput<Page> & {
      /** Test seam: the head's poll period, 30 seconds in the product. */
      readonly refetchIntervalMs?: number
    },
  ) =>
    queryOptions({
      queryKey: [...input.queryKey, 'head'],
      enabled: input.enabled,
      queryFn: ({ signal }) => input.browse(null, signal),
      refetchInterval: input.refetchIntervalMs ?? MessagePages.headRefreshIntervalMs,
      retry: false,
    })

  /**
   * Replaces the newest loaded page with the freshly polled head, keeping any message the head no longer carries
   * (a shift in the newest window must not erase content the reader can already see) and dropping ids the head or that
   * carried-over tail already holds, so an older page cannot render or key the same message twice.
   */
  static readonly merge = <Page extends MessagePage>(input: { readonly head: Page | undefined; readonly pages: readonly Page[] }): readonly Page[] => {
    if (input.head === undefined) return input.pages
    if (input.pages.length === 0) return [input.head]

    const headIds = new Set(input.head.items.map(message => message.id))
    const carried = (input.pages[0]?.items ?? []).filter(message => !headIds.has(message.id))
    const first = carried.length === 0 ? input.head : { ...input.head, items: [...input.head.items, ...carried] }
    const seen = new Set([...headIds, ...carried.map(message => message.id)])
    return [first, ...input.pages.slice(1).map(page => ({ ...page, items: page.items.filter(message => !seen.has(message.id)) }))]
  }
}

export type { CommunicationMessagePage }
