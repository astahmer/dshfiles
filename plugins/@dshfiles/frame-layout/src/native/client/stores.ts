/**
 * Root-owned frame measurement, panel preferences, and presentation reports.
 * The registration supplies a fresh store and binds its actions to ctx.layout.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MainSurfaceMode, RightPanelMode } from '../../regions.ts'
import type { MainPanelId } from './service.ts'
import {
  BOTTOM_DEFAULT, BOTTOM_MAX_RATIO, BOTTOM_MIN,
  clampWidth, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Transient layout preferences. Responsive concessions never rewrite widths;
 * the right panel's expanded state belongs to its occupant.
 */
type LayoutState = {
  panelInfo: {
    /** Null selects the Conversation; global panels keep the current Session intact. */
    activePanelId: MainPanelId | null
  }
  layoutInfo: LayoutInfo
}

type LayoutInfo = {
  /** Requested centre owner; deliberately not persisted until the default-flip phase. */
  mainSurfaceMode: MainSurfaceMode
  sidebar: number
  /**
   * Last non-zero sidebar width. Reopening a collapsed sidebar restores it
   * instead of the contract default (local delta; see README "Local delta").
   */
  sidebarLastOpen: number
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number
  narrowExpanded: boolean
  /**
   * Saved right panel width in px, or null before its first opening. Resizing
   * the frame and closing the panel preserve this preference.
   */
  rightbar: number | null
  /**
   * Whether the right panel is drawn at all, in either presentation.
   *
   * Derived chrome, not a source of truth: whether the right surface is
   * expanded is a recorded fact owned by that surface, reported here so the
   * frame can place the panel's resize handle. The occupant reports it; nothing
   * else writes it.
   */
  rightbarShown: boolean
  /**
   * Whether the normal panel width reserves a grid track, including beneath
   * fullscreen. Reported by the occupant; always false while hidden.
   */
  rightbarTrack: boolean
  /** Reported fullscreen presentation; hides the outer resize handle. */
  rightbarFullscreen: boolean
  /** Suppress transitions for a fullscreen exit until another geometry action. */
  rightbarInstant: boolean
  /**
   * Which surface fills the right column (local delta; see README "Local
   * delta"): the native per-session right sidebar, or the global dock a plugin
   * registers into `shell.dock`. Reported through `ctx.rightPanel`, so the
   * column keeps one owner at a time.
   */
  rightPanelMode: RightPanelMode
  /**
   * Preferred bottom-row height in px, or null before its first opening. The
   * frame owns this row (local delta; see README "Local delta"), because a full
   * width row's height belongs to the frame's row solve, not to one occupant.
   */
  bottom: number | null
  /** Whether the bottom row is drawn. Opened and closed through `ctx.frameBottom`. */
  bottomShown: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  selectPanel: (draft: LayoutState, panelId: MainPanelId | null) => void
  retainMainPanels: (draft: LayoutState, panelIds: readonly string[]) => void
  setSidebar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  showSidebar: (draft: LayoutState) => void
  setViewportWidth: (draft: LayoutState, width: number) => void
  setRightbar: (draft: LayoutState, px: number) => void
  openRightbar: (draft: LayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: LayoutState) => void
  setMode: (draft: LayoutState, mode: RightPanelMode) => void
  setMainSurfaceMode: (draft: LayoutState, mode: MainSurfaceMode) => void
  setBottom: (draft: LayoutState, px: number) => void
  openBottom: (draft: LayoutState, px?: number) => void
  closeBottom: (draft: LayoutState) => void
}
/**
 * Create the layout panel store handle. For the sidebar the preference IS the
 * width, so closing it forgets its drag width — reopening restores the contract
 * default. The right panel initializes at 45% of the frame on first opening
 * and keeps that px preference across resizes and close. Drag writes clamp to
 * the current frame's range. Narrow sidebar toggles change only the expansion
 * override; opening the right panel clears that override.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      panelInfo: { activePanelId: null },
      layoutInfo: {
        mainSurfaceMode: 'native',
        sidebar: SIDEBAR_DEFAULT,
        sidebarLastOpen: SIDEBAR_DEFAULT,
        viewportWidth: window.innerWidth,
        narrowExpanded: false,
        rightbar: null,
        rightbarShown: false,
        rightbarTrack: false,
        rightbarFullscreen: false,
        rightbarInstant: false,
        rightPanelMode: 'native',
        bottom: null,
        bottomShown: false,
      },
    }),
    actions: {
      selectPanel: (d, panelId: MainPanelId | null) => {
        d.panelInfo.activePanelId = panelId
      },
      retainMainPanels: (d, panelIds: readonly string[]) => {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) {
          d.panelInfo.activePanelId = null
        }
      },
      setSidebar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        const width = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
        d.layoutInfo.sidebar = width
        d.layoutInfo.sidebarLastOpen = width
      },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        d.layoutInfo.rightbarInstant = false
        if (d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded
        else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? d.layoutInfo.sidebarLastOpen : 0
      },
      // Recovery is a show intent, not a toggle: repeated calls in one React
      // batch read the live draft and never close an already-visible sidebar.
      showSidebar: (d) => {
        d.layoutInfo.rightbarInstant = false
        if (d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) d.layoutInfo.narrowExpanded = true
        else d.layoutInfo.sidebar = d.layoutInfo.sidebarLastOpen
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setViewportWidth: (d, width: number) => {
        if (d.layoutInfo.viewportWidth === width) return
        d.layoutInfo.rightbarInstant = false
        if ((d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) !== (width < SIDEBAR_AUTO_COLLAPSE)) {
          d.layoutInfo.narrowExpanded = false
        }
        d.layoutInfo.viewportWidth = width
      },
      setRightbar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.rightbar = clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, d.layoutInfo.viewportWidth * RIGHTBAR_MAX_RATIO))
      },
      openRightbar: (d, track: boolean, fullscreen: boolean) => {
        if (!d.layoutInfo.rightbarShown || d.layoutInfo.rightbarTrack !== track || d.layoutInfo.rightbarFullscreen !== fullscreen) {
          d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen && !fullscreen
        }
        if (!d.layoutInfo.rightbarShown && d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) d.layoutInfo.narrowExpanded = false
        d.layoutInfo.rightbar ??= Math.max(RIGHTBAR_MIN, Math.round(d.layoutInfo.viewportWidth * RIGHTBAR_DEFAULT_RATIO))
        d.layoutInfo.rightbarShown = true
        d.layoutInfo.rightbarTrack = track
        d.layoutInfo.rightbarFullscreen = fullscreen
      },
      closeRightbar: (d) => {
        if (d.layoutInfo.rightbarShown) d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen
        d.layoutInfo.rightbarShown = false
        d.layoutInfo.rightbarTrack = false
        d.layoutInfo.rightbarFullscreen = false
      },
      // The frame's right column has one owner at a time: a plugin takes it
      // over for its global dock, or hands it back to the native surface.
      setMainSurfaceMode: (d, mode: MainSurfaceMode) => {
        d.layoutInfo.mainSurfaceMode = mode
      },
      setMode: (d, mode: RightPanelMode) => {
        d.layoutInfo.rightPanelMode = mode
      },
      // The bottom row's height lives here, so reopening restores what the user
      // dragged instead of the contract default.
      setBottom: (d, px: number) => {
        d.layoutInfo.bottom = clampWidth(px, BOTTOM_MIN, Math.max(BOTTOM_MIN, Math.round(window.innerHeight * BOTTOM_MAX_RATIO)))
      },
      openBottom: (d, px?: number) => {
        if (px !== undefined) d.layoutInfo.bottom = clampWidth(px, BOTTOM_MIN, Math.max(BOTTOM_MIN, Math.round(window.innerHeight * BOTTOM_MAX_RATIO)))
        d.layoutInfo.bottom ??= BOTTOM_DEFAULT
        d.layoutInfo.bottomShown = true
      },
      closeBottom: (d) => {
        d.layoutInfo.bottomShown = false
      },
    },
  })
  return handle
}
