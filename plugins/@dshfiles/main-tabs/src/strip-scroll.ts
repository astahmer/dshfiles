/** Sub-pixel layout noise is not worth a scroll: box edges come back fractional. */
const REVEAL_TOLERANCE_PX = 1

/** How far `scroller` must scroll to hold `tab` whole; 0 when the tab is already inside. */
export const revealOffset = (scroller: Pick<DOMRect, 'left' | 'right'>, tab: Pick<DOMRect, 'left' | 'right'>): number => {
  const deficit = tab.left < scroller.left ? tab.left - scroller.left : tab.right > scroller.right ? tab.right - scroller.right : 0
  return Math.abs(deficit) < REVEAL_TOLERANCE_PX ? 0 : deficit
}

/**
 * Bring a tab into view by scrolling the strip alone, never past what the strip can scroll. `scrollIntoView` also
 * scrolls every scrollable ancestor, and the frame's clipped centre column is one, so a reveal could move more than
 * the strip.
 */
export const revealTabInStrip = (scroller: HTMLElement, tab: Element | null): void => {
  if (tab === null) return
  const offset = revealOffset(scroller.getBoundingClientRect(), tab.getBoundingClientRect())
  if (offset === 0) return
  const furthest = Math.max(scroller.scrollWidth - scroller.clientWidth, 0)
  const target = Math.min(Math.max(scroller.scrollLeft + offset, 0), furthest)
  if (Math.abs(target - scroller.scrollLeft) < REVEAL_TOLERANCE_PX) return
  scroller.scrollLeft = target
}
