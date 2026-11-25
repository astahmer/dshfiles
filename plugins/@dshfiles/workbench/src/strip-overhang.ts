/**
 * One chrome (council round 3 B1). A folded sidebar draws its open header row (the wordmark, Back, Forward, New
 * thread, ⌘K) over the top-left corner of the stage, and publishes how far it reaches as `--dshfiles-sidebar-overhang`
 * (thread-sidebar's `sidebar-fold.ts`). The main region's top-left group starts its tab row after it, so its tabs
 * begin where they do with the column open. `<html data-workbench-main-strip>` says a main region with tab rows is
 * mounted (counted, so a remount never clears another's mark); the sidebar draws that row only over such a strip.
 */

/** On `<html>` while a main region is mounted. */
const ROOT_ATTRIBUTE = 'data-workbench-main-strip'
/** On the one tab row the overhang covers. */
const ROW_ATTRIBUTE = 'data-workbench-top-start'

let mounted = 0

/** Mark `<html>` for one mounted main region; the returned function releases the mark. */
const mount = (root: HTMLElement = document.documentElement): (() => void) => {
  mounted += 1
  root.setAttribute(ROOT_ATTRIBUTE, '')
  return () => {
    mounted = Math.max(0, mounted - 1)
    if (mounted === 0) root.removeAttribute(ROOT_ATTRIBUTE)
  }
}

interface Box {
  readonly top: number
  readonly left: number
}

/** The index of the box at the top-left corner: the topmost row, then its leftmost box (1 px tolerance). */
const topStart = (boxes: readonly Box[]): number => {
  let best = -1
  for (const [index, box] of boxes.entries()) {
    const current = boxes[best]
    if (current === undefined || box.top < current.top - 1 || (Math.abs(box.top - current.top) <= 1 && box.left < current.left)) best = index
  }
  return best
}

/** Mark the tab row of the group at the region's top-left corner, and clear the mark on every other row. */
const markRows = (rows: readonly HTMLElement[]): void => {
  const start = topStart(rows.map(row => row.getBoundingClientRect()))
  for (const [index, row] of rows.entries()) row.toggleAttribute(ROW_ATTRIBUTE, index === start)
}

export class StripOverhang {
  static readonly ROOT_ATTRIBUTE = ROOT_ATTRIBUTE
  static readonly ROW_ATTRIBUTE = ROW_ATTRIBUTE
  static readonly mount = mount
  static readonly topStart = topStart
  static readonly markRows = markRows
}
