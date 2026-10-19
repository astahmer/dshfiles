/**
 * The frame's panel seats: which occupant the right column shows, the
 * `shell.dock` slot a global dock registers into, and the bottom row a panel
 * surface registers into (`shell.bottom`, declared by the layout contract) whose
 * height the frame owns and reports through `ctx.frameBottom`.
 *
 * The frame owns the columns, the rows and their geometry; a plugin owns the
 * surfaces inside them. Read the seats through `ctx.get('rightPanel')` and
 * `ctx.get('frameBottom')`: both are absent on a frame that does not offer them
 * (the stock layout package), so a dock plugin stays inert there.
 */
import type { RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Which surface fills the frame's right column. */
export type RightPanelMode = 'native' | 'dock'

/** The seat control behind `ctx.rightPanel` (provided by `@dshfiles/frame-layout`). */
export interface RightPanelSeat {
  /** Hand the column to the global dock, or back to the native per-session surface. */
  readonly setMode: (mode: RightPanelMode) => void
  /**
   * Which surface the column renders right now. A caller asks before acting on
   * a surface, so it never drives one the frame is not drawing.
   */
  readonly mode: () => RightPanelMode
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only while the owned frame is the layout owner. */
    rightPanel?: RightPanelSeat
    /** Present only while the owned frame is the layout owner. */
    frameBottom?: FrameBottomSeat
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The frame's right column, taken over by a global dock while the column's
     * mode is `dock`. The occupant renders its surface anchored to the frame's
     * right edge and reports its presentation through `ctx.layout` exactly as
     * the native `rightbar` occupant does; it receives the same resolved
     * geometry share.
     */
    'shell.dock': {
      kind: 'single'
      scope: 'root'
      owner: RightbarOwnerProps
    }
  }
}
