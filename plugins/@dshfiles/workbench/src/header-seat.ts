/**
 * One header row on the thread stage (visual refresh T1.4). A thread panel's conversation header (title, actions,
 * view switch) moves into its own Dockview group's tab row, beside the tabs, instead of drawing a second and third
 * row under them. The header is React-portalled into a seat element this module owns inside the group header, so it
 * keeps the panel's Session binding; the tabs themselves are untouched and stay draggable (D6).
 *
 * No seat (the header renders inline, as its own single row under the tabs) while the panel is not its group's
 * visible tab, while the group's tab row is hidden (Hide tab row), while the row has less than SEAT_MIN_FREE_PX
 * beside its tabs (a half-width split or many open tabs cannot hold the header in the same row), in the main region
 * while its tab rows are hidden (showMainTabs off, productivity pass Q5), and in the phone shell, where the workbench hides
 * tab rows and the conversation header moves into the top bar's menu.
 */
import type { DockviewApi, DockviewGroupPanel, DockviewPanelApi } from 'dockview-react'
import { createContext, useContext, useLayoutEffect, useState } from 'react'
import { TabRows } from './tab-row-visibility.js'

export interface PanelChrome {
  readonly api: DockviewPanelApi
  readonly containerApi: DockviewApi
}

/** Provided by the workbench around each registered panel; absent outside a Dockview panel. */
export const PanelChromeContext = createContext<PanelChrome | null>(null)

const SEAT_ATTRIBUTE = 'data-workbench-header-seat'
/** The header needs about this much of the tab row beside the tabs (title, actions, view switch, utilities). */
export const SEAT_MIN_FREE_PX = 640
const PHONE_QUERY = '(max-width: 639.98px)'

const phoneShell = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches && document.documentElement.hasAttribute('data-shell-phone-nav')

/**
 * Set by the Workbench from its showMainTabs setting (b:4v6p): off hides the main region's tab rows (dockview-theme.css),
 * so a header there renders inline. Since the one sidebar layout (b:952m) the setting alone decides.
 */
export const MAIN_TABS_ATTRIBUTE = 'data-workbench-main-tabs'
export const mainTabsHidden = (): boolean => document.documentElement.getAttribute(MAIN_TABS_ATTRIBUTE) === 'hidden'
const hiddenMainRow = (group: DockviewGroupPanel): boolean => mainTabsHidden() && group.element.closest("[data-workbench-region='main']") !== null

export class HeaderSeats {
  /** The group's seat element, created on first use just before its right-hand actions. */
  static seatOf(group: DockviewGroupPanel): HTMLElement | null {
    const header = group.element.querySelector(':scope > .dv-tabs-and-actions-container')
    if (!(header instanceof HTMLElement)) return null
    const existing = header.querySelector(`:scope > [${SEAT_ATTRIBUTE}]`)
    if (existing instanceof HTMLElement) return existing
    const seat = header.ownerDocument.createElement('div')
    seat.setAttribute(SEAT_ATTRIBUTE, '')
    header.insertBefore(seat, header.querySelector(':scope > .dv-right-actions-container'))
    return seat
  }

  /** The row width left beside the tabs (their full scroll width, so a seated header does not count against it). */
  static freeWidth(group: DockviewGroupPanel): number {
    const tabs = group.element.querySelector(':scope > .dv-tabs-and-actions-container .dv-tabs-container')
    return group.element.clientWidth - (tabs instanceof HTMLElement ? tabs.scrollWidth : 0)
  }

  /** Where this panel's header belongs now: its group's seat, or null for inline. */
  static resolve(api: DockviewPanelApi): HTMLElement | null {
    const group = api.group
    if (!api.isVisible || group.header.hidden || phoneShell() || hiddenMainRow(group) || HeaderSeats.freeWidth(group) < SEAT_MIN_FREE_PX) return null
    return HeaderSeats.seatOf(group)
  }
}

/** The seat a thread panel portals its header into, kept current across tab, group, row and viewport changes. */
export const useHeaderSeat = (): HTMLElement | null => {
  const chrome = useContext(PanelChromeContext)
  const [seat, setSeat] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (chrome === null) return
    const { api, containerApi } = chrome
    const update = (): void => setSeat(HeaderSeats.resolve(api))
    update()
    const subscriptions = [
      api.onDidVisibilityChange(update),
      api.onDidGroupChange(update),
      api.onDidLocationChange(update),
      containerApi.onDidLayoutChange(update),
    ]
    const releaseRows = TabRows.subscribe(containerApi, update)
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : undefined
    media?.addEventListener('change', update)
    // Showing or hiding the main tab rows moves the header in or out of the tab row.
    const layout = typeof MutationObserver === 'function' ? new MutationObserver(update) : undefined
    layout?.observe(document.documentElement, { attributes: true, attributeFilter: [MAIN_TABS_ATTRIBUTE] })
    // The group's width decides too (a sash drag or a window resize), and so do its tabs (one opened or closed);
    // a moved panel changes group.
    let observed: HTMLElement | undefined
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined
    const tabsChanged = typeof MutationObserver === 'function' ? new MutationObserver(update) : undefined
    const observeGroup = (): void => {
      const element = api.group.element
      if (element === observed) return
      if (observed !== undefined) resize?.unobserve(observed)
      tabsChanged?.disconnect()
      observed = element
      resize?.observe(element)
      const tabs = element.querySelector(':scope > .dv-tabs-and-actions-container .dv-tabs-container')
      if (tabs !== null) tabsChanged?.observe(tabs, { childList: true, subtree: true, characterData: true })
    }
    observeGroup()
    const groupMoves = api.onDidGroupChange(observeGroup)
    return () => {
      for (const subscription of subscriptions) subscription.dispose()
      groupMoves.dispose()
      resize?.disconnect()
      tabsChanged?.disconnect()
      releaseRows()
      layout?.disconnect()
      media?.removeEventListener('change', update)
      setSeat(null)
    }
  }, [chrome])
  return seat
}
