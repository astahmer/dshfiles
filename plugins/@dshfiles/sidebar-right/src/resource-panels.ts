/** Presentation-only bridge. The native session store and TabDomain own every record and resource lifetime. */
export interface SidebarResourcePanel {
  readonly id: string
  readonly sessionId: string
  readonly tabId: string
  readonly kind: string
  readonly title: string
  readonly address: string
  /** Native TabDomain navigation revision; repeated opens reveal the existing Dockview occurrence. */
  readonly navigationRevision: number
}

export interface SidebarResourceTarget {
  readonly id: string
  readonly element: HTMLElement
  readonly visible: boolean
}

export interface SidebarResourcePanels {
  readonly list: () => readonly SidebarResourcePanel[]
  readonly subscribe: (listener: () => void) => () => void
  /** Attach a presentation target, never a resource or session. Moving a panel only detaches this target. */
  readonly attach: (id: string, element: HTMLElement) => () => void
  /** Forward the embedder's actual panel visibility; retained hidden bodies must not steal focus or resize terminals. */
  readonly setVisible: (id: string, element: HTMLElement, visible: boolean) => void
  /** Explicit content close, including the original provider's synchronous cleanup admission. May throw. */
  readonly close: (id: string) => void
  /** Explicit picker intent. The native owner reports the exact ID before publishing its record; never reveals another pane. */
  readonly openPage?: (kind: string, beforePublish: (id: string) => void) => boolean
  /** Owner-only lifetime of the adopted Session page opener; absent on an older already-loaded bridge. */
  readonly registerPageOpener?: (open: (kind: string, beforePublish: (id: string) => void) => boolean) => () => void
  readonly targets: {
    readonly getSnapshot: () => readonly SidebarResourceTarget[]
    readonly subscribe: (listener: () => void) => () => void
  }
  /** Owner-only projection of committed records; the disposer cannot remove a newer session projection. */
  readonly publish: (sessionId: string, panels: readonly SidebarResourcePanel[], close: (tabId: string) => void) => () => void
}

export class SidebarResourcePanelModel {
  static id(sessionId: string, tabId: string): string {
    return `dshfiles-resource/${encodeURIComponent(sessionId)}/${encodeURIComponent(tabId)}`
  }

  static create(): SidebarResourcePanels {
    const sessions = new Map<string, { readonly panels: readonly SidebarResourcePanel[]; readonly close: (tabId: string) => void }>()
    const listeners = new Set<() => void>()
    const targetListeners = new Set<() => void>()
    const attached = new Map<string, { readonly target: SidebarResourceTarget; readonly token: symbol }>()
    let panels: readonly SidebarResourcePanel[] = []
    let targets: readonly SidebarResourceTarget[] = []
    let pageOpener: SidebarResourcePanels['openPage'] | undefined
    const publishTargets = (): void => {
      targets = [...attached.values()].map(value => value.target)
      for (const listener of targetListeners) listener()
    }
    const notify = (): void => {
      panels = [...sessions.values()].flatMap(session => session.panels)
      for (const listener of listeners) listener()
    }
    return {
      list: () => panels,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      attach: (id, element) => {
        const token = Symbol(id)
        attached.set(id, { target: { id, element, visible: true }, token })
        publishTargets()
        return () => {
          if (attached.get(id)?.token !== token) return
          attached.delete(id)
          publishTargets()
        }
      },
      setVisible: (id, element, visible) => {
        const current = attached.get(id)
        if (current === undefined || current.target.element !== element || current.target.visible === visible) return
        attached.set(id, { ...current, target: { ...current.target, visible } })
        publishTargets()
      },
      close: id => {
        const panel = panels.find(panel => panel.id === id)
        if (panel !== undefined) sessions.get(panel.sessionId)?.close(panel.tabId)
      },
      openPage: (kind, beforePublish) => pageOpener?.(kind, beforePublish) ?? false,
      registerPageOpener: open => {
        pageOpener = open
        return () => {
          if (pageOpener === open) pageOpener = undefined
        }
      },
      targets: {
        getSnapshot: () => targets,
        subscribe: listener => {
          targetListeners.add(listener)
          return () => {
            targetListeners.delete(listener)
          }
        },
      },
      publish: (sessionId, next, close) => {
        const projection = { panels: next, close }
        sessions.set(sessionId, projection)
        notify()
        return () => {
          if (sessions.get(sessionId) !== projection) return
          sessions.delete(sessionId)
          notify()
        }
      },
    }
  }
}

declare global {
  var dshfilesSidebarResourcePanelsV1: SidebarResourcePanels | undefined
}

/** Inlined dshx modules share this one versioned registry across browser bundles. */
export const sidebarResourcePanels = (): SidebarResourcePanels => (globalThis.dshfilesSidebarResourcePanelsV1 ??= SidebarResourcePanelModel.create())
