/** A native, Session-scoped pane handoff; never enters the global registry/main-view open queue. */
export const createNativeAsidePlacement = <Surface>(show: (surface: Surface, panelId: string) => void) => {
  const surfaces = new Map<string, Surface>()
  const pending = new Map<string, Set<string>>()
  let disposed = false
  return {
    request: (sessionId: string, panelId: string): void => {
      if (disposed) return
      const surface = surfaces.get(sessionId)
      if (surface !== undefined) show(surface, panelId)
      else {
        const panels = pending.get(sessionId) ?? new Set<string>()
        panels.add(panelId)
        pending.set(sessionId, panels)
      }
    },
    attach: (sessionId: string, surface: Surface): (() => void) => {
      if (disposed) return () => undefined
      surfaces.set(sessionId, surface)
      const panels = pending.get(sessionId)
      pending.delete(sessionId)
      for (const panelId of panels ?? []) show(surface, panelId)
      return () => {
        if (surfaces.get(sessionId) === surface) surfaces.delete(sessionId)
      }
    },
    dispose: (): void => {
      disposed = true
      surfaces.clear()
      pending.clear()
    },
  }
}
