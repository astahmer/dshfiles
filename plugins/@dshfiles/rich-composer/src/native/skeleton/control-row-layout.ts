/** Content-sized model collapse for the composer's two control groups. */

/**
 * Collapse the model text only when the expanded controls cannot share a line.
 * The model seat consumes the row's inherited display variables; wrapping remains
 * available when even the icon cannot fit. Sizes come from ResizeObserver entries,
 * delivered after layout and before paint, so no notification forces a layout.
 * Collapsed widths do not show expanded demand: a content change while collapsed
 * re-expands the row, and the next delivery collapses it again before paint when
 * it still does not fit.
 * @param row - Composer control row with its leading and trailing groups.
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(row: HTMLElement): () => void {
  const widths = new Map<Element, number>()
  let available = 0
  let expandedDemand = 0
  const compact = (): boolean => row.hasAttribute('data-model-compact')
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === row) available = entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width
      else widths.set(entry.target, entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width)
    }
    if (compact()) {
      if (expandedDemand <= available) row.removeAttribute('data-model-compact')
      return
    }
    const present = Array.from(row.children, child => widths.get(child) ?? 0).filter(width => width > 0)
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
    const needed = present.reduce((sum, width) => sum + width, 0) + Math.max(0, present.length - 1) * gap
    if (needed <= available) return
    expandedDemand = needed
    row.setAttribute('data-model-compact', '')
  })
  const observeChildren = (): void => {
    for (const child of row.children) {
      if (widths.has(child)) continue
      widths.set(child, 0)
      resize.observe(child)
    }
    for (const child of widths.keys()) {
      if (child.parentElement === row) continue
      widths.delete(child)
      resize.unobserve(child)
    }
  }
  const expand = (): void => { row.removeAttribute('data-model-compact') }
  const mutation = new MutationObserver(() => {
    observeChildren()
    if (compact()) expand()
  })
  mutation.observe(row, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'],
  })
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', expand)
  resize.observe(row)
  observeChildren()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    fonts.removeEventListener('loadingdone', expand)
  }
}
