import type { DockviewApi } from 'dockview-react'

const TABLIST_SELECTOR = '.dv-tabs-container'
const ACTIVE_TAB_SELECTOR = ':scope > .dv-tab.dv-active-tab'
/** Marks a strip whose tabs run past an edge; the theme fades that edge so a cut-off tab reads as "more this way". */
const CLIPPED_ATTRIBUTE = 'data-workbench-tabs-clipped'
/** Sub-pixel layout leaves fractions that are not a hidden tab. */
const EDGE_TOLERANCE_PX = 1
/** Width of the theme's fade (dockview-theme.css): a selected tab inside it would lose its glyph or its close button. */
const FADE_PX = 28

type StripMetrics = Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>
type Edges = 'start' | 'end' | 'both' | undefined

/** The selected tab's box, measured from the strip's visible start edge. */
interface ActiveTabBox {
  readonly start: number
  readonly end: number
}

const edges = (start: boolean, end: boolean): Edges => {
  if (start && end) return 'both'
  if (start) return 'start'
  return end ? 'end' : undefined
}

/** A scrolled tab strip hides tabs behind an edge with no scrollbar to say so: name the clipped edges for the theme. */
export class TabStripEdges {
  /** The edges tabs run past. */
  static clipped(strip: StripMetrics): Edges {
    return edges(strip.scrollLeft > EDGE_TOLERANCE_PX, strip.scrollWidth - strip.clientWidth - strip.scrollLeft > EDGE_TOLERANCE_PX)
  }

  /** The clipped edges to fade: an edge the selected tab sits on stays sharp, so the selected tab is never the faded one. */
  static faded(strip: StripMetrics, active?: ActiveTabBox): Edges {
    const clipped = TabStripEdges.clipped(strip)
    if (clipped === undefined || active === undefined) return clipped
    const onStart = active.start < FADE_PX && active.end > 0
    const onEnd = active.end > strip.clientWidth - FADE_PX && active.start < strip.clientWidth
    return edges(clipped !== 'end' && !onStart, clipped !== 'start' && !onEnd)
  }

  static mark(strip: HTMLElement): void {
    const active = strip.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR)
    const origin = strip.getBoundingClientRect().left
    const box = active?.getBoundingClientRect()
    const faded = TabStripEdges.faded(strip, box === undefined ? undefined : { start: box.left - origin, end: box.right - origin })
    if (faded === undefined) strip.removeAttribute(CLIPPED_ATTRIBUTE)
    else if (strip.getAttribute(CLIPPED_ATTRIBUTE) !== faded) strip.setAttribute(CLIPPED_ATTRIBUTE, faded)
  }

  /** Keep one strip marked while it scrolls; the disposer clears the mark. */
  static watch(strip: HTMLElement): () => void {
    const onScroll = (): void => TabStripEdges.mark(strip)
    strip.addEventListener('scroll', onScroll, { passive: true })
    TabStripEdges.mark(strip)
    return () => {
      strip.removeEventListener('scroll', onScroll)
      strip.removeAttribute(CLIPPED_ATTRIBUTE)
    }
  }

  /** Every group's strip, re-marked when it scrolls, when it or a tab resizes, and when tabs come, go or are selected. */
  static retain(api: DockviewApi): () => void {
    const watched = new Map<HTMLElement, () => void>()
    const observer = new ResizeObserver(() => {
      for (const strip of watched.keys()) TabStripEdges.mark(strip)
    })
    const sync = (): void => {
      const strips = new Set(api.groups.flatMap(group => group.element.querySelector<HTMLElement>(TABLIST_SELECTOR) ?? []))
      for (const [strip, release] of watched) {
        if (strips.has(strip) && strip.isConnected) continue
        release()
        observer.unobserve(strip)
        watched.delete(strip)
      }
      for (const strip of strips) {
        if (!watched.has(strip)) watched.set(strip, TabStripEdges.watch(strip))
        // A title that loads later widens its tab without resizing the strip itself.
        observer.observe(strip)
        for (const tab of Array.from(strip.children)) observer.observe(tab)
        TabStripEdges.mark(strip)
      }
    }
    sync()
    const subscriptions = [
      api.onDidAddGroup(sync),
      api.onDidRemoveGroup(sync),
      api.onDidAddPanel(sync),
      api.onDidRemovePanel(sync),
      api.onDidActivePanelChange(sync),
      api.onDidLayoutFromJSON(sync),
    ]
    return () => {
      for (const subscription of subscriptions) subscription.dispose()
      observer.disconnect()
      for (const release of watched.values()) release()
      watched.clear()
    }
  }
}
