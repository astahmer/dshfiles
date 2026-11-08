/** Content-sized model collapse for the composer's two control groups. */

/**
 * Width the row's direct children need on one line, against the width it offers.
 * @param row - Composer control row.
 * @returns Needed and available inline sizes in CSS pixels.
 */
function lineDemand(row: HTMLElement): { needed: number, available: number } {
  const style = getComputedStyle(row)
  const available = row.getBoundingClientRect().width
    - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const widths = Array.from(row.children, child => child.getBoundingClientRect().width)
    .filter(width => width > 0)
  const needed = widths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
  return { needed, available }
}

/**
 * Collapse the control row in steps, only as far as its width requires: first
 * `data-model-compact` (the model drops its effort, the gaps tighten), then
 * `data-controls-wrap` when even the compact groups cannot share one line. The
 * wrap flag flattens both groups so controls wrap one by one with the model and
 * send kept together at the trailing edge, instead of the whole trailing group
 * dropping to its own line beside an almost empty first line. Each notification
 * is measured synchronously from the expanded state.
 * @param row - Composer control row with its leading and trailing groups.
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(row: HTMLElement): () => void {
  const measure = (): void => {
    // Always measure expanded demand, including text changed while collapsed.
    row.removeAttribute('data-model-compact')
    row.removeAttribute('data-controls-wrap')
    const expanded = lineDemand(row)
    const compact = expanded.needed > expanded.available
    row.toggleAttribute('data-model-compact', compact)
    if (!compact) return
    const collapsed = lineDemand(row)
    row.toggleAttribute('data-controls-wrap', collapsed.needed > collapsed.available)
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row)
  for (const child of row.children) resize.observe(child)
  const mutation = new MutationObserver(measure)
  mutation.observe(row, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'],
  })
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', measure)
  measure()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    fonts.removeEventListener('loadingdone', measure)
  }
}
