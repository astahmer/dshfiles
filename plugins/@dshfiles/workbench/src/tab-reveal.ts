import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

const TABLIST_SELECTOR = '.dv-tabs-container'
const ACTIVE_TAB_SELECTOR = '.dv-tabs-container > .dv-tab.dv-active-tab'
/** Sub-pixel layout noise is not worth a scroll: Dockview reports fractional tab edges. */
const REVEAL_TOLERANCE_PX = 1
/**
 * A tab mounts in pieces (title, project chip, close button, status dot), and Dockview scrolls the strip at activation
 * before those widths exist. Revealing on every one of those resizes moved the strip back and forth several times per
 * open, which reads as the strip vibrating. Wait for the strip to stop resizing, then correct once.
 */
const REVEAL_SETTLE_MS = 100

const settled = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** How far `strip` must scroll to hold `tab` whole; 0 when the tab is already inside. */
export const revealOffset = (strip: Pick<DOMRect, 'left' | 'right'>, tab: Pick<DOMRect, 'left' | 'right'>): number => {
  const deficit = tab.left < strip.left ? tab.left - strip.left : tab.right > strip.right ? tab.right - strip.right : 0
  return Math.abs(deficit) < REVEAL_TOLERANCE_PX ? 0 : deficit
}

/**
 * Scroll the strip itself, by the few pixels its selected tab misses, and never past what the strip can scroll. A
 * clipped tab's left-aligned target can sit hundreds of pixels past the end; the browser clamps the write, the next
 * reveal measures the same clip again, and the strip keeps nudging instead of settling.
 */
const scrollIntoStrip = (strip: HTMLElement, tab: HTMLElement): void => {
  const offset = revealOffset(strip.getBoundingClientRect(), tab.getBoundingClientRect())
  if (offset === 0) return
  const furthest = Math.max(strip.scrollWidth - strip.clientWidth, 0)
  const target = Math.min(Math.max(strip.scrollLeft + offset, 0), furthest)
  if (Math.abs(target - strip.scrollLeft) < REVEAL_TOLERANCE_PX) return
  strip.scrollLeft = target
}

/** Dockview scrolls at activation, before React has mounted the title and header actions that set the final widths. */
export class TabReveal {
  /**
   * Scroll only the strip, and only once its layout settles: `scrollIntoView` also scrolls every scrollable ancestor
   * (the group, the workbench root, the frame's clipped centre column), and revealing on each mounted part's resize
   * made the strip oscillate.
   */
  static reveal(group: DockviewGroupPanel): void {
    const tab = group.element.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR)
    const strip = tab?.parentElement ?? null
    if (tab === null || strip === null) return
    const pending = settled.get(strip)
    if (pending !== undefined) clearTimeout(pending)
    settled.set(
      strip,
      setTimeout(() => {
        settled.delete(strip)
        if (!tab.isConnected) return
        scrollIntoStrip(strip, tab)
      }, REVEAL_SETTLE_MS),
    )
  }

  /** Drop pending work for a strip that is going away. */
  static cancel(strip: Element): void {
    const pending = settled.get(strip)
    if (pending === undefined) return
    clearTimeout(pending)
    settled.delete(strip)
  }

  /**
   * Reveal when the world around the strip changes size, not when its own content settles. Tabs mount in pieces
   * (title, project chip, close button, status dot) and Dockview scrolls at activation before those widths exist;
   * correcting on each of those resizes moved the strip back and forth several times per open, which reads as the
   * strip vibrating. A window resize still re-reveals the selected tab of every group.
   */
  static retain(api: DockviewApi): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const revealAll = (): void => {
      for (const group of api.groups) TabReveal.reveal(group)
    }
    const onResize = (): void => {
      clearTimeout(timer)
      timer = setTimeout(revealAll, REVEAL_SETTLE_MS)
    }
    window.addEventListener('resize', onResize)
    const loaded = api.onDidLayoutFromJSON(revealAll)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
      loaded.dispose()
      for (const group of api.groups) {
        const strip = group.element.querySelector(TABLIST_SELECTOR)
        if (strip !== null) TabReveal.cancel(strip)
      }
    }
  }
}
