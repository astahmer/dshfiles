/** Already-loaded history the graph keeps below the viewport before it asks the Host for another page. */
const MINIMUM_LOOKAHEAD = 2400
const LOOKAHEAD_VIEWPORTS = 8

type GraphPageScope = { readonly repoId: string | null; readonly query: string; readonly generation: number }

export class GraphPagingModel {
  /** Cached pages and delayed responses belong only to the exact repository/search/refresh snapshot that requested them. */
  static readonly samePageSet = (left: GraphPageScope, right: GraphPageScope): boolean =>
    left.repoId === right.repoId && left.query === right.query && left.generation === right.generation

  /** Revisions the graph loads before anything scrolls, so a first look is never a single page. */
  static readonly revisionFloor = 200

  /** Every loaded revision joins the next layout, so an automatic chain stops before that work outgrows a page. */
  static readonly revisionLimit = 2000

  static readonly lookahead = (viewportHeight: number): number => Math.max(MINIMUM_LOOKAHEAD, viewportHeight * LOOKAHEAD_VIEWPORTS)

  static readonly needsAnotherPage = (input: { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number }): boolean =>
    input.scrollHeight - input.scrollTop - input.clientHeight <= GraphPagingModel.lookahead(input.clientHeight)

  /** A page lands below the viewport; this decides whether the list tops itself up now instead of waiting for the next scroll event. */
  static readonly shouldLoadNextPage = (input: {
    readonly loadedRevisions: number
    readonly scrollTop: number
    readonly scrollHeight: number
    readonly clientHeight: number
  }): boolean =>
    input.loadedRevisions < GraphPagingModel.revisionLimit &&
    (input.loadedRevisions < GraphPagingModel.revisionFloor || GraphPagingModel.needsAnotherPage(input))

  /** Where the next page starts. The loaded revisions it excludes only grow, so their count and last id name the request. */
  static readonly cursor = (excludeCommitIds: readonly string[]): string => `${excludeCommitIds.length}:${excludeCommitIds.at(-1) ?? ''}`

  /** A page that failed at a cursor fails again there, so it is asked for again only once the loaded history moves. */
  static readonly canRequestPage = (input: {
    readonly hasMore: boolean
    readonly pending: boolean
    readonly cursor: string
    readonly failedCursor: string | null
  }): boolean => input.hasMore && !input.pending && input.cursor !== input.failedCursor

  /** A page that adds no new revision leaves the cursor where it was; asking again would return the same page. */
  static readonly hasMoreAfterPage = (input: { readonly hasMore: boolean; readonly addedRevisions: number }): boolean =>
    input.hasMore && input.addedRevisions > 0
}
