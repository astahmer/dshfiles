import type { ComponentType } from 'react'

/** The workbench's own `main` panel key; a contributor checks the slot ledger for it to know the workbench is loaded. */
export const WORKBENCH_MAIN_PANEL_ID = 'dshfiles-workbench'

export interface WorkbenchPanelProps {
  readonly panelId: string
}

export interface WorkbenchPanelDefinition {
  /** Stable across reloads: saved layouts refer to panels by this id. Prefix it with the owning plugin. */
  readonly id: string
  readonly title: string
  readonly component: ComponentType<WorkbenchPanelProps>
  /**
   * Leads the global dock's default layout. The panel the persistent right-hand
   * surface exists for marks itself, so the workbench needs no list of ids; a
   * saved layout always wins over this.
   */
  readonly dockDefault?: boolean
  /**
   * The `main` panel key the same feature registers, when it has one. A panel
   * that names it can move between the dock and the full main view: the
   * workbench selects that key to move it out, and offers the panel here to move
   * it back in.
   */
  readonly mainPanelId?: string
}

export interface WorkbenchPanelRegistry {
  /** Returns the disposer; a later registration of the same id replaces the earlier one. */
  readonly register: (definition: WorkbenchPanelDefinition) => () => void
  readonly get: (id: string) => WorkbenchPanelDefinition | undefined
  readonly list: () => readonly WorkbenchPanelDefinition[]
  /** Asks the workbench to show the panel; kept until the workbench takes it, so it works before the view mounts. */
  readonly open: (id: string) => void
  readonly hasOpenRequests: () => boolean
  readonly takeOpenRequests: () => readonly string[]
  readonly subscribe: (listener: () => void) => () => void
}

export const createWorkbenchPanelRegistry = (): WorkbenchPanelRegistry => {
  const definitions = new Map<string, WorkbenchPanelDefinition>()
  const listeners = new Set<() => void>()
  const openRequests: string[] = []
  let snapshot: readonly WorkbenchPanelDefinition[] = []

  const notify = (): void => {
    snapshot = [...definitions.values()]
    for (const listener of listeners) listener()
  }

  return {
    register: definition => {
      definitions.set(definition.id, definition)
      notify()
      return () => {
        if (definitions.get(definition.id) !== definition) return
        definitions.delete(definition.id)
        notify()
      }
    },
    get: id => definitions.get(id),
    list: () => snapshot,
    open: id => {
      const queued = openRequests.indexOf(id)
      if (queued !== -1) openRequests.splice(queued, 1)
      openRequests.push(id)
      for (const listener of listeners) listener()
    },
    hasOpenRequests: () => openRequests.length > 0,
    takeOpenRequests: () => openRequests.splice(0),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

declare global {
  /** One registry per page, shared by every bundle; the name carries the contract version. */
  var dshfilesWorkbenchPanelsV1: WorkbenchPanelRegistry | undefined
}

/**
 * The page-wide registry. Each plugin bundle inlines this module, so the instance lives on `globalThis`: whichever
 * bundle loads first creates it, and contributors may register before the workbench loads.
 */
export const workbenchPanels = (): WorkbenchPanelRegistry => (globalThis.dshfilesWorkbenchPanelsV1 ??= createWorkbenchPanelRegistry())
