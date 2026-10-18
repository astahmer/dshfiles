/** Already-loaded history the graph keeps below the viewport before it asks the Host for another page. */
const MINIMUM_LOOKAHEAD = 1200
const LOOKAHEAD_VIEWPORTS = 3

export class GraphPagingModel {
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
}
