/** Already-loaded history the graph keeps below the viewport before it asks the Host for another page. */
const MINIMUM_LOOKAHEAD = 1200
const LOOKAHEAD_VIEWPORTS = 2

type GraphPageScope = { readonly repoId: string | null; readonly query: string; readonly generation: string }

export class GraphPagingModel {
  /**
   * Older pages belong to one first-page snapshot. A refresh that reads the same repository keeps the same query data
   * reference, so only a changed snapshot starts a new page set and scrolled history survives every unchanged poll.
   */
  static readonly snapshotGeneration = <State>(
    previous: { readonly state: State | undefined; readonly generation: number },
    state: State | undefined,
  ): { readonly state: State | undefined; readonly generation: number } =>
    previous.state === state ? previous : { state, generation: previous.generation + 1 }

  /** A search reads its own history from the top; the graph's own first page is already in the repository read. */
  static readonly firstPageExclude = (input: { readonly query: string; readonly baseCommitIds: readonly string[] }): readonly string[] =>
    input.query.length > 0 ? [] : input.baseCommitIds

  /** The next page excludes what is already loaded; a page that added nothing ends the chain, whatever the Host says. */
  static readonly nextPageExclude = (input: {
    readonly hasMore: boolean
    readonly addedCommitIds: readonly string[]
    readonly excludeCommitIds: readonly string[]
  }): readonly string[] | undefined => (input.hasMore && input.addedCommitIds.length > 0 ? [...input.excludeCommitIds, ...input.addedCommitIds] : undefined)

  /** A repository read and the search text name the page set an infinite query is keyed by. */
  static readonly pageSetScope = (pageSet: GraphPageScope): string => `${pageSet.repoId ?? ''}|${pageSet.query}|${pageSet.generation}`

  /** Revisions the graph loads before anything scrolls, so a first look is never a single page. */
  static readonly revisionFloor = 40

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
}
