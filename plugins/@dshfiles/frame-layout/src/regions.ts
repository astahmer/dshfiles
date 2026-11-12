/**
 * The frame's panel seats: observable centre ownership and its authorized
 * keyed-main renderer (`shell.main`), the right column's global dock
 * (`shell.dock`), and the bottom row a panel
 * surface registers into (`shell.bottom`, declared by the layout contract) whose
 * height the frame owns and reports through `ctx.frameBottom`.
 *
 * The frame owns the columns, the rows and their geometry; a plugin owns the
 * surfaces inside them. Read the seats through `ctx.get('rightPanel')` and
 * `ctx.get('frameBottom')`: both are absent on a frame that does not offer them
 * (the stock layout package), so a dock plugin stays inert there.
 */
import type { RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ReactNode } from 'react'

/** Which surface fills the frame's centre column. Native remains the default. */
export type MainSurfaceMode = 'native' | 'workbench'

/** The observable, browser-local control behind `ctx.mainSurface`. */
export interface MainSurfaceSeat {
  /** Requested mode; an empty `shell.main` seat still falls back to native. */
  readonly mode: () => MainSurfaceMode
  /** Hand the centre to its registered occupant, or restore native navigation. */
  readonly setMode: (mode: MainSurfaceMode) => void
  /** Subscribe to mode changes only; returns an unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
  /** Navigation intents include reselecting the same main key after docking focus changed. */
  readonly subscribePanelRequests?: (listener: (panelId: string | null) => void) => () => void
}

/** Owner share supplied by the frame to the root `shell.main` occupant. */
export interface MainSurfaceOwnerProps {
  /**
   * Render a keyed `main` entry with the frame's authorization. `conversation`
   * follows the current thread. The legacy `dshfiles-workbench` key returns
   * null so the workbench cannot recursively host itself through this bridge.
   * This grants no authority over other slots or another plugin's private slots.
   */
  readonly renderMain: (entryKey: string) => ReactNode
}

/** Owner share supplied by the frame to `shell.beforeMain` entries. */
export interface BeforeMainOwnerProps {
  /** The centre's requested surface; Workbench draws its own chrome, so a native strip renders nothing there. */
  readonly mode: MainSurfaceMode
  /**
   * Hide the main panel below the seat while it stays mounted (scroll and state survive), until the returned release
   * runs. The panel shows again once every hold is released.
   */
  readonly holdMainHidden: () => () => void
}

/** Compatibility ownership for frames deployed without Workbench; not a user preference. */
export type RightPanelMode = 'native' | 'dock'

/** Workbench-owned right-pane actions, shared with existing sidebar controls. */
export interface DockPaneActions {
  readonly isOpen: () => boolean
  readonly open: () => void
  readonly close: () => void
  readonly toggle: () => void
  /** Observe open-state changes; returns an unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
}

/** Dock geometry plus visibility; older frames may omit the visibility share. */
export interface DockPaneOwnerProps extends RightbarOwnerProps {
  /** False keeps views mounted in a hidden carrier without reserving geometry. */
  readonly shown?: boolean
}

/** The seat control behind `ctx.rightPanel` (provided by `@dshfiles/frame-layout`). */
export interface RightPanelSeat {
  /** Hand the column to the global dock, or back to the native per-session surface. */
  readonly setMode: (mode: RightPanelMode) => void
  /**
   * Which surface the column renders right now. A caller asks before acting on
   * a surface, so it never drives one the frame is not drawing.
   */
  readonly mode: () => RightPanelMode
  /** Register the real dock controls until disposed. Latest live registration wins. */
  readonly registerDock?: (actions: DockPaneActions) => () => void
  /** Available even while hidden; absent before registration or after frame teardown. */
  readonly dock?: () => DockPaneActions | undefined
}

/** Frame-owned recovery control; callers never infer visibility from stale rendered props. */
export interface FrameSidebarSeat {
  /** Show the left sidebar idempotently at its remembered width, including on narrow frames. */
  readonly show: () => void
}

/** The seat control behind `ctx.frameBottom` (provided by `@dshfiles/frame-layout`). */
export interface FrameBottomSeat {
  /** Show the bottom row, at `height` px or the last/default height. */
  readonly open: (height?: number) => void
  /** Hide the bottom row; its registered occupant stays registered. */
  readonly close: () => void
  /** Rendered row height in px, 0 while hidden. */
  readonly height: () => number
}

/**
 * The seat behind `ctx.zen` (provided by `@dshfiles/frame-layout`): zen mode leaves the thread and its composer and
 * hides the sidebar, right panel, status strip and main tabs. Browser-local window presentation; it never writes
 * another owner's settings, so leaving restores the layout exactly. `<html data-dshfiles-zen="on">` mirrors it for
 * owners that hide their own chrome in CSS.
 */
export interface ZenSeat {
  readonly on: () => boolean
  readonly set: (on: boolean) => void
  /** Subscribe to changes, including another tab's; returns an unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only while the owned frame is the layout owner. */
    mainSurface?: MainSurfaceSeat
    /** Present only while the owned frame is the layout owner. */
    rightPanel?: RightPanelSeat
    /** Present only while the owned frame is the layout owner. */
    frameBottom?: FrameBottomSeat
    /** Idempotent left-sidebar reveal; absent on older or stock frame bundles. */
    frameSidebar?: FrameSidebarSeat
    /** Zen mode; absent on older or stock frame bundles. */
    zen?: ZenSeat
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Tab-controlled left content, declared by the owned sidebar. The sidebar
     * keeps its brand/history/customize row and account/settings/footer chrome
     * outside this seat. Collapsing must not unmount its live docking region.
     */
    'shell.left': {
      kind: 'single'
      scope: 'root'
      owner: { readonly collapsed: boolean }
    }
    /**
     * Root centre surface. Mounted in workbench mode, with the selected native
     * `main` entry as the empty-seat fallback. The frame retains render authority
     * for `main` and delegates only the guarded keyed renderer in the owner share.
     */
    'shell.main': {
      kind: 'single'
      scope: 'root'
      owner: MainSurfaceOwnerProps
    }
    /**
     * Full-width rows at the top of the centre column, directly above the main panel in both surface modes, mounted
     * for the frame's lifetime across panel and thread changes. Additive: entries order among themselves. The tab
     * strip of `@dshfiles/main-tabs` lives here.
     */
    'shell.beforeMain': {
      kind: 'list'
      scope: 'root'
      owner: BeforeMainOwnerProps
    }
    /**
     * The frame's right column. In Workbench mode the dock stays mounted while
     * closed, inside a hidden carrier with `shown: false`; it must report closed
     * geometry through `ctx.layout`. When shown it fills the resolved full-height
     * right region. Older frames may omit `shown`.
     */
    'shell.dock': {
      kind: 'single'
      scope: 'root'
      owner: DockPaneOwnerProps
    }
  }
}
