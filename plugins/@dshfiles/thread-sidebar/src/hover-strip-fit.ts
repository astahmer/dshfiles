/**
 * Which hover actions a thread row's strip draws (council round 28, item 1). The strip lives in the first line's time
 * slot: the row menu `⋯` always shows there (the time slot is at least one seat wide), and each further action shows only
 * when its whole button starts clear of the resting title's last glyph, so a click anywhere on the title opens the
 * thread and never lands on Done or Snooze. The actions that do not fit stay in `⋯`, which holds every row verb.
 */

/** A strip seat: a 24px button. */
export const STRIP_SEAT_PX = 24
/** The gap between seats. */
export const STRIP_GAP_PX = 2
/** The clear space an action keeps from the title's last glyph, so it never sits right next to the title. */
export const STRIP_CLEAR_PX = 8

/** The attribute that shows an action seat; seats without it stay hidden (`dshx:hidden dshx:data-[strip-on]:contents`). */
export const STRIP_SEAT_ON = 'data-strip-on'

/**
 * How many actions fit left of the row menu: the largest k (at most `actions`) whose strip, k actions and `⋯` ending at
 * `stripRight`, starts at least `STRIP_CLEAR_PX` right of `glyphRight`.
 */
const seatsThatFit = (input: { readonly stripRight: number; readonly glyphRight: number; readonly actions: number }): number => {
  let fit = 0
  for (let k = 1; k <= input.actions; k += 1) {
    const left = input.stripRight - (k + 1) * STRIP_SEAT_PX - k * STRIP_GAP_PX
    if (left < input.glyphRight + STRIP_CLEAR_PX) break
    fit = k
  }
  return fit
}

/**
 * The right edge of a title's last drawn glyph: its text's own extent, not its flex box (a short title ends well before
 * its box). A truncated title draws its ellipsis at the box's end, so the box clamps it.
 */
const glyphRight = (title: Element): number => {
  const box = title.getBoundingClientRect()
  const range = title.ownerDocument.createRange()
  range.selectNodeContents(title)
  const rects = Array.from(range.getClientRects())
  range.detach()
  if (rects.length === 0) return box.left
  return Math.min(box.right, Math.max(...rects.map(rect => rect.right)))
}

/** Measure one row and show the action seats that fit; called as the pointer enters it or focus moves into it. */
const apply = (row: HTMLElement): number => {
  const strip = row.querySelector('[data-row-strip]')
  const title = row.querySelector('[data-thread-title]')
  if (strip === null) return 0
  const seats = Array.from(strip.querySelectorAll<HTMLElement>(':scope > [data-strip-seat]'))
  const fit = title === null ? seats.length : seatsThatFit({ stripRight: strip.getBoundingClientRect().right, glyphRight: glyphRight(title), actions: seats.length })
  seats.forEach((seat, index) => seat.toggleAttribute(STRIP_SEAT_ON, index < fit))
  return fit
}

export class HoverStripFit {
  static readonly seatsThatFit = seatsThatFit
  static readonly glyphRight = glyphRight
  static readonly apply = apply
}
