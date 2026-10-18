/**
 * The frame's right-column seat: which occupant the column shows, and the
 * `shell.dock` slot a global dock registers into.
 *
 * The frame owns the column and its geometry; a dock plugin owns the surface.
 * One call hands the column over and one takes it back, so the column keeps a
 * single owner at a time — the native per-session right sidebar by default, the
 * global dock while a plugin asks for it. Read the seat through
 * `ctx.get('rightPanel')`: it is absent on a frame that does not offer it.
 */
import type { RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Which surface fills the frame's right column. */
export type RightPanelMode = 'native' | 'dock'

/** The seat control behind `ctx.rightPanel` (provided by `@dshfiles/frame-layout`). */
export interface RightPanelSeat {
  /** Hand the column to the global dock, or back to the native per-session surface. */
  readonly setMode: (mode: RightPanelMode) => void
  /** The surface the column shows now, so a caller can toggle without tracking the setting itself. */
  readonly mode: () => RightPanelMode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only while the owned frame is the layout owner. */
    rightPanel?: RightPanelSeat
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
