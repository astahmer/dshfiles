/** A vertical extent in the scroller's content coordinates (0 is the top of its scrolled content). */
export interface ScrollExtent {
  readonly top: number
  readonly bottom: number
}

/** Room left above a group label the column scrolls to, so the label never sits on the edge. */
const LABEL_ROOM = 8

/**
 * Where the Settings column scrolls when its current row changes (council round 18 B2.4). The current row comes into
 * view at its nearest edge (never the centre). Then, when the top edge cuts a group under its label, the column moves
 * up to that label, as long as the current row still shows: a group's rows never sit under the edge with their label
 * hidden above it. Pure: the caller measures and scrolls.
 */
const target = (input: {
  readonly scrollTop: number
  /** The scroller's visible height. */
  readonly height: number
  readonly row: ScrollExtent
  /** Every group block (its label and its rows). */
  readonly groups: readonly ScrollExtent[]
}): number => {
  const { height, row, groups } = input
  let top = input.scrollTop
  if (row.top < top) top = row.top
  else if (row.bottom > top + height) top = row.bottom - height
  const cut = groups.find(group => group.top < top && group.bottom > top)
  if (cut === undefined) return top
  const labelled = Math.max(0, cut.top - LABEL_ROOM)
  return row.bottom <= labelled + height ? labelled : top
}

/** The nearest ancestor that scrolls vertically. */
const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/** Scroll `column`'s scroller to show its current row (`aria-current="page"`) and the label of the group cut at the top. */
const reveal = (column: HTMLElement): void => {
  const current = [...column.querySelectorAll<HTMLElement>('[aria-current="page"]')].at(-1)
  if (current === undefined) return
  const scroller = scrollerOf(column)
  if (scroller === null) return
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop
  const extent = (element: Element): ScrollExtent => {
    const box = element.getBoundingClientRect()
    return { top: box.top - origin, bottom: box.bottom - origin }
  }
  const next = target({
    scrollTop: scroller.scrollTop,
    height: scroller.clientHeight,
    row: extent(current),
    groups: [...column.querySelectorAll('[data-settings-group]')].map(extent),
  })
  if (Math.abs(next - scroller.scrollTop) >= 1) scroller.scrollTop = next
}

export const SettingsColumnScroll = { target, reveal }
