import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

const TABLIST_SELECTOR = '.dv-tabs-container'
const ACTIVE_TAB_SELECTOR = '.dv-tabs-container > .dv-tab.dv-active-tab'
/** How far a strip must move from the last revealed offset before a resize is treated as the user scrolling it. */
const USER_SCROLL_TOLERANCE_PX = 4

/** The offset each strip had when its selected tab was last revealed, so a resize caused by scrolling never snaps back. */
const revealedAt = new WeakMap<Element, number>()

/** Dockview scrolls at activation, before React has mounted the title and header actions that set the final widths. */
export class TabReveal {
  static reveal(group: DockviewGroupPanel): void {
    const tab = group.element.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR)
    if (tab === null || typeof tab.scrollIntoView !== 'function') return
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const strip = tab.parentElement
    if (strip !== null) revealedAt.set(strip, strip.scrollLeft)
  }

  /** A strip that narrows after activation (its header actions mount, or the window resizes) clips the selected tab again. */
  static retain(api: DockviewApi): () => void {
    const observed = new Set<Element>()
    const observer = new ResizeObserver(() => {
      for (const group of api.groups) {
        const strip = group.element.querySelector(TABLIST_SELECTOR)
        if (strip === null) continue
        const revealed = revealedAt.get(strip)
        if (revealed !== undefined && Math.abs(strip.scrollLeft - revealed) > USER_SCROLL_TOLERANCE_PX) continue
        TabReveal.reveal(group)
      }
    })
    const observeStrips = (): void => {
      for (const group of api.groups) {
        const strip = group.element.querySelector(TABLIST_SELECTOR)
        if (strip !== null) {
          observer.observe(strip)
          observed.add(strip)
        }
      }
      for (const strip of observed)
        if (!strip.isConnected) {
          observer.unobserve(strip)
          observed.delete(strip)
        }
    }
    observeStrips()
    const added = api.onDidAddGroup(observeStrips)
    const removed = api.onDidRemoveGroup(observeStrips)
    const loaded = api.onDidLayoutFromJSON(() => {
      observeStrips()
      for (const group of api.groups) TabReveal.reveal(group)
    })
    return () => {
      added.dispose()
      removed.dispose()
      loaded.dispose()
      observer.disconnect()
    }
  }
}
