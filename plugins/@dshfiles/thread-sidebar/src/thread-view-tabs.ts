import { useLayoutEffect, useState } from 'react'

/**
 * A row narrower than the full tabs need swaps names for icons, so every tab stays visible without scrolling. The
 * required width is measured from the full labels themselves, so a row that fits them keeps the names.
 */
export const viewTabsNeedCompactLabels = (input: { readonly rowWidth: number; readonly requiredWidth: number }): boolean =>
  input.rowWidth > 0 && input.requiredWidth > 0 && input.rowWidth < input.requiredWidth

/**
 * Whether the tab row shows compact labels. `fullTabs` is an invisible copy of the row with every full name, laid out
 * at its natural width; its width is what the visible row needs.
 */
export const useCompactViewTabs = (row: HTMLElement | null, fullTabs: HTMLElement | null): boolean => {
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    if (row === null || fullTabs === null) return
    const measure = () => setCompact(viewTabsNeedCompactLabels({ rowWidth: row.clientWidth, requiredWidth: fullTabs.scrollWidth }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(fullTabs)
    return () => observer.disconnect()
  }, [row, fullTabs])
  return compact
}
