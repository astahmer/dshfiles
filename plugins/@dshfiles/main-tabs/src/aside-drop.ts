/**
 * The frame marks the right column, and DSH's native right sidebar renders inside that column's `rightbar` slot outlet.
 * A thread tab dropped while the pointer is over that outlet moves into the side panel; anywhere else it reorders.
 */
const RIGHT_COLUMN_SELECTOR = '[data-rightbar-col]'
const RIGHTBAR_OUTLET_SELECTOR = '[data-slot="rightbar"]'

/** The column attribute the drag highlight styles, removed as soon as the pointer leaves it. */
export const ASIDE_DROP_ATTRIBUTE = 'data-dshfiles-aside-drop'

/** The right column under one pointer position while the native right sidebar is there, or null anywhere else. */
export const asideDropColumn = (document: Document, point: { readonly x: number; readonly y: number }): HTMLElement | null => {
  const hit = document.elementFromPoint?.(point.x, point.y)
  if (hit === null || hit === undefined) return null
  const outlet = hit.closest(RIGHTBAR_OUTLET_SELECTOR)
  const column = outlet?.closest(RIGHT_COLUMN_SELECTOR)
  return column instanceof HTMLElement ? column : null
}
