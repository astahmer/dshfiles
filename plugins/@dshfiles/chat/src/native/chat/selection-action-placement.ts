/** Desktop: the Annotate button's centre stays this far from the window edges. */
const EDGE_MARGIN_PX = 72
/** Touch: Android's selection handles hang about 24px under the line; the action clears them by 8px more. */
const HANDLE_CLEARANCE_PX = 32
const TOUCH_TARGET_PX = 44
const TOUCH_MARGIN_PX = 8

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The visible part of the page: `window.visualViewport`, which shrinks above the on-screen keyboard. */
export interface Viewport {
  readonly offsetLeft: number
  readonly offsetTop: number
  readonly width: number
  readonly height: number
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * The part of `bounds` inside the visual viewport.
 * @param input - bounds in layout-viewport coordinates and the visual viewport.
 * @returns their intersection.
 */
export const withinViewport = (input: { readonly bounds: Box; readonly viewport: Viewport }): Box => ({
  left: Math.max(input.bounds.left, input.viewport.offsetLeft),
  top: Math.max(input.bounds.top, input.viewport.offsetTop),
  right: Math.min(input.bounds.right, input.viewport.offsetLeft + input.viewport.width),
  bottom: Math.min(input.bounds.bottom, input.viewport.offsetTop + input.viewport.height),
})

/**
 * Where a selection action sits on touch. The native selection toolbar (Android's Copy/Share, iOS's callout) owns the
 * space above a selection, so the action goes under the selection's end, clear of the drag handles, kept inside
 * `bounds` (the visual viewport, so the keyboard never hides it).
 * @param input - the selection's last line, the action's size and the area it must stay in.
 * @returns the action's top-left corner.
 */
export const touchActionPlacement = (input: {
  readonly end: Box
  readonly width: number
  readonly height: number
  readonly bounds: Box
}): { readonly left: number; readonly top: number } => ({
  left: clamp(input.end.right - input.width / 2, input.bounds.left + TOUCH_MARGIN_PX, input.bounds.right - TOUCH_MARGIN_PX - input.width),
  top: clamp(input.end.bottom + HANDLE_CLEARANCE_PX, input.bounds.top + TOUCH_MARGIN_PX, input.bounds.bottom - TOUCH_MARGIN_PX - input.height),
})

export interface AnnotatePlacement {
  /** Fixed-position x of the button's centre. */
  readonly left: number
  /** Fixed-position y: the selection's top on desktop (the button rises above it), the button's top on touch. */
  readonly top: number
  readonly side: 'above' | 'below'
}

const overlaps = (a: Box, b: Box): boolean => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom

/**
 * Where the Annotate button floats: centred above the selection on desktop, under its end on touch, where it steps
 * past the Quote action (`avoid`) that touch also puts there: below it, or above it when the viewport has no room.
 * @param input - the selection's bounds, the bounds of its last line, the window width, the visual viewport, the input kind, the button's width and the touch Quote action's bounds.
 * @returns the button's anchor point and which side of the selection it takes.
 */
export const annotatePlacement = (input: {
  readonly selection: Box
  readonly end: Box
  readonly windowWidth: number
  readonly viewport: Viewport
  readonly touch: boolean
  readonly buttonWidth: number
  readonly avoid?: Box | undefined
}): AnnotatePlacement => {
  if (!input.touch) {
    const centre = (input.selection.left + input.selection.right) / 2
    return { left: clamp(centre, EDGE_MARGIN_PX, input.windowWidth - EDGE_MARGIN_PX), top: input.selection.top, side: 'above' }
  }
  const viewport = input.viewport
  const bounds = { left: viewport.offsetLeft, top: viewport.offsetTop, right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height }
  const placed = touchActionPlacement({ end: input.end, width: input.buttonWidth, height: TOUCH_TARGET_PX, bounds })
  const left = placed.left + input.buttonWidth / 2
  const avoid = input.avoid
  const box = (top: number): Box => ({ left: placed.left, top, right: placed.left + input.buttonWidth, bottom: top + TOUCH_TARGET_PX })
  if (avoid === undefined || !overlaps(box(placed.top), avoid)) return { left, top: placed.top, side: 'below' }
  const under = avoid.bottom + TOUCH_MARGIN_PX
  const top = under + TOUCH_TARGET_PX <= bounds.bottom - TOUCH_MARGIN_PX ? under : avoid.top - TOUCH_MARGIN_PX - TOUCH_TARGET_PX
  return { left, top, side: 'below' }
}
