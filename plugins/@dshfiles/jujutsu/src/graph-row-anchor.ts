/** A revision row the pointer acted on, measured before its row could grow (a panel opened) or shrink (one closed). */
export interface GraphRowAnchor {
  readonly commitId: string
  /** The row's top relative to the scroll container, before the interaction changed any row height. */
  readonly top: number
  /** The container's viewport height at the same moment, to tell a fully visible row from one cut by the fold. */
  readonly viewportHeight: number
  readonly rowHeight: number
}

/** A row the pointer acted on keeps its place: expanding it never scrolls the graph away from what was clicked. */
export class GraphRowAnchorModel {
  static readonly scrollDelta = (input: { readonly anchor: GraphRowAnchor; readonly currentTop: number }): number => {
    const { anchor } = input
    // A row cut by the fold would open its panel off-screen; bring its header to the top instead of keeping it hidden.
    if (anchor.top < 0 || anchor.top + anchor.rowHeight > anchor.viewportHeight) return input.currentTop
    return input.currentTop - anchor.top
  }

  static readonly shouldScroll = (delta: number): boolean => Math.abs(delta) >= 1
}
