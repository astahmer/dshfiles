import { useLayoutEffect, useState } from 'react'

/** The width one view tab needs to show its full name, attention dot and count without truncating. */
const FULL_VIEW_TAB_WIDTH = 120
const VIEW_TAB_GAP = 4

/** A row too narrow for every full tab swaps names for icons, so every tab stays visible without scrolling. */
export const viewTabsNeedCompactLabels = (input: { readonly rowWidth: number; readonly tabCount: number }): boolean =>
  input.tabCount > 0 && input.rowWidth > 0 && input.rowWidth < input.tabCount * FULL_VIEW_TAB_WIDTH + (input.tabCount - 1) * VIEW_TAB_GAP

export const useCompactViewTabs = (row: HTMLElement | null, tabCount: number): boolean => {
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    if (row === null) return
    const measure = (rowWidth: number) => setCompact(viewTabsNeedCompactLabels({ rowWidth, tabCount }))
    measure(row.clientWidth)
    const observer = new ResizeObserver(entries => measure(entries.at(-1)?.contentRect.width ?? row.clientWidth))
    observer.observe(row)
    return () => observer.disconnect()
  }, [row, tabCount])
  return compact
}
