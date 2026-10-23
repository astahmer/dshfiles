/**
 * How long the frame keeps a vanished panel selected. A plugin's hot reload unregisters its `main` entry before the
 * rebuilt bundle registers it again (the client runtime tears the old entry down first), and an agent rebuilding a
 * plugin in the background must not throw the user out of the panel they are working in.
 */
export const PANEL_REREGISTER_GRACE_MS = 15_000

interface PanelRetentionInput {
  readonly activePanelId: () => string | null
  readonly panelKeys: () => readonly string[]
  /** Upstream's `retainMainPanels`: clears the selection when the active panel is not among `keys`. */
  readonly release: (keys: readonly string[]) => void
  readonly schedule: (run: () => void, delayMs: number) => () => void
}

/**
 * Upstream drops the selection the moment the active panel's entry disappears, which turns every reload of that
 * plugin into a jump back to the thread. This waits the grace out first and releases only a panel that is still gone.
 */
const createPanelRetention = (input: PanelRetentionInput): { readonly check: () => void; readonly dispose: () => void } => {
  let cancelPending: (() => void) | undefined
  const cancel = (): void => {
    cancelPending?.()
    cancelPending = undefined
  }
  const check = (): void => {
    const active = input.activePanelId()
    if (active === null || input.panelKeys().includes(active)) {
      cancel()
      return
    }
    if (cancelPending !== undefined) return
    cancelPending = input.schedule(() => {
      cancelPending = undefined
      input.release(input.panelKeys())
    }, PANEL_REREGISTER_GRACE_MS)
  }
  return { check, dispose: cancel }
}

export class PanelRetentionModel {
  static readonly create = createPanelRetention
}
