import type { DockPaneActions, RightPanelSeat } from './regions.js'
import type { createLayoutStore } from './native/client/stores.js'

/** A frame-lifetime registry: Workbench owns actions, the frame owns their availability. */
export function createRightPanelSeat(
  instance: ReturnType<ReturnType<typeof createLayoutStore>['create']>,
): RightPanelSeat & Required<Pick<RightPanelSeat, 'registerDock' | 'dock'>> & { readonly dispose: () => void } {
  const registrations = new Map<symbol, DockPaneActions>()
  let disposed = false
  return {
    setMode: mode => { if (!disposed) instance.actions.setMode(mode) },
    mode: () => instance.getSnapshot().layoutInfo.rightPanelMode,
    registerDock: actions => {
      if (disposed) return () => undefined
      const key = Symbol('dock pane')
      registrations.set(key, actions)
      return () => { registrations.delete(key) }
    },
    dock: () => {
      let current: DockPaneActions | undefined
      for (const actions of registrations.values()) current = actions
      return current
    },
    dispose: () => {
      disposed = true
      registrations.clear()
    },
  }
}
