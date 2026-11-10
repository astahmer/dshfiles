import type { ComponentType } from 'react'
import * as Schema from 'effect/Schema'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { trimmedString } from './schema.js'

/** The workbench's own `main` panel key; a contributor checks the slot ledger for it to know the workbench is loaded. */
export const WORKBENCH_MAIN_PANEL_ID = 'dshfiles-workbench'

export interface WorkbenchPanelProps {
  readonly panelId: string
  /** Close this occurrence, not an unrelated global page. */
  readonly onClose?: () => void
  readonly visible?: boolean
}

export interface ThreadFacetObservable<T> {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => T
}

/** A native right-pane page type offered as a thread facet, read from its guide entry. */
export interface ThreadFacet {
  /** The native page kind a pick opens for the on-screen thread. */
  readonly kind: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
  readonly icon?: ComponentType<{ readonly size?: number | undefined; readonly className?: string | undefined }>
  /** The thread a pick would open the facet for; a chooser disables the row while none is on screen. */
  readonly onScreen?: ThreadFacetObservable<string | undefined>
}

/** A reusable plugin view: every docking pane accepts this same renderer contract. */
export interface WorkbenchPanelDefinition {
  /** Stable across reloads: saved layouts refer to panels by this id. Prefix it with the owning plugin. */
  readonly id: string
  readonly title: string
  readonly component: ComponentType<WorkbenchPanelProps>
  /** An owned contributor may expose independent scoped occurrences (e.g. two repositories). */
  readonly scopedComponent?: ComponentType<WorkbenchPanelProps & { readonly scope: string }>
  /** Semantic actor identity; tab chrome reads its live metadata from the shared provider. */
  readonly tabId?: string
  /** Runtime occurrences (thread/resource tabs) are not duplicate Add-panel sources. */
  readonly hiddenFromAdd?: boolean
  /** Reusable views open independent occurrences by default; set false for a singleton or launcher. */
  readonly allowMultiple?: boolean
  /** A semantic Start occurrence uses the same New tab chooser as every pane. */
  readonly newView?: boolean
  /** Called only for an explicit user close, never for cross-surface adoption. May reject by throwing. */
  readonly beforeClose?: () => void
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
  /** Whether this panel appears in the thread-item and header-tab side-panel menus by default. */
  readonly showInContextMenu?: boolean
  /** Whether this panel appears in the side-panel workbench's empty state by default. */
  readonly showInEmptyState?: boolean
  /** A launcher for a thread facet: choosers list it under Thread panels with its guide description and icon. */
  readonly threadFacet?: ThreadFacet
}

const panelIdSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u))
const panelDefinitionSchema = Schema.Struct({ id: panelIdSchema, title: trimmedString(Schema.String.check(Schema.isMinLength(1))) })
const panelPreferenceSchema = Schema.Struct({
  contextMenu: Schema.Boolean,
  emptyState: Schema.Boolean,
  order: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
})
const panelPreferencesSchema = Schema.Record(Schema.String.check(Schema.isMinLength(1)), panelPreferenceSchema)
const isStrictPanelPreference = (value: unknown): value is WorkbenchPanelPreference => Schema.is(panelPreferenceSchema)(value)

const emptyPanelPreferences: Record<string, WorkbenchPanelPreference> = {}
const storedPanelPreferences = createStoredValue({
  key: 'dshfiles.workbench.side-panel-preferences.v1',
  schema: panelPreferencesSchema,
  fallback: emptyPanelPreferences,
})

export interface WorkbenchPanelPreference {
  readonly contextMenu: boolean
  readonly emptyState: boolean
  readonly order: number
}

export interface WorkbenchPanelRegistry {
  /** Returns the disposer; a later registration of the same id replaces the earlier one. */
  readonly register: (definition: WorkbenchPanelDefinition) => () => void
  readonly get: (id: string) => WorkbenchPanelDefinition | undefined
  readonly list: () => readonly WorkbenchPanelDefinition[]
  readonly listContextMenuPanels: () => readonly WorkbenchPanelDefinition[]
  readonly preference: (id: string) => WorkbenchPanelPreference | undefined
  readonly setPreference: (id: string, preference: WorkbenchPanelPreference) => boolean
  readonly movePreference: (id: string, direction: 'earlier' | 'later') => boolean
  /** Asks the workbench to show the panel; kept until the workbench takes it, so it works before the view mounts. */
  readonly open: (id: string) => void
  readonly hasOpenRequests: () => boolean
  readonly takeOpenRequests: () => readonly string[]
  readonly subscribe: (listener: () => void) => () => void
  /**
   * Run several registrations and disposals; subscribers hear them once, at the end. Optional: a registry created by
   * an older bundle on this page lacks it.
   */
  readonly batch?: (change: () => void) => void
}

export const createWorkbenchPanelRegistry = (): WorkbenchPanelRegistry => {
  const definitions = new Map<string, WorkbenchPanelDefinition>()
  const listeners = new Set<() => void>()
  const openRequests: string[] = []
  let snapshot: readonly WorkbenchPanelDefinition[] = []
  let batchDepth = 0
  let batchChanged = false

  const notify = (): void => {
    if (batchDepth > 0) {
      batchChanged = true
      return
    }
    snapshot = [...definitions.values()]
    for (const listener of listeners) listener()
  }

  const preference = (id: string): WorkbenchPanelPreference | undefined => {
    const definition = definitions.get(id)
    if (definition === undefined) return undefined
    const stored = storedPanelPreferences.get()[id]
    return (
      stored ?? {
        contextMenu: definition.showInContextMenu ?? false,
        emptyState: definition.showInEmptyState ?? false,
        order: snapshot.findIndex(panel => panel.id === id),
      }
    )
  }

  return {
    register: definition => {
      if (!Schema.is(panelDefinitionSchema)(definition)) throw new TypeError('Workbench panel id and title must be valid.')
      definitions.set(definition.id, definition)
      notify()
      return () => {
        if (definitions.get(definition.id) !== definition) return
        definitions.delete(definition.id)
        notify()
      }
    },
    batch: change => {
      batchDepth += 1
      try {
        change()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0 && batchChanged) {
          batchChanged = false
          notify()
        }
      }
    },
    get: id => definitions.get(id),
    list: () => snapshot,
    listContextMenuPanels: () => snapshot.filter(panel => !panel.hiddenFromAdd && panel.tabId === undefined && preference(panel.id)?.contextMenu === true),
    preference,
    setPreference: (id, preference) => {
      if (!definitions.has(id) || !isStrictPanelPreference(preference)) return false
      storedPanelPreferences.set({ ...storedPanelPreferences.get(), [id]: preference })
      notify()
      return true
    },
    movePreference: (id, direction) => {
      const ordered = snapshot
        .map(panel => ({
          id: panel.id,
          preference: { ...(preference(panel.id) ?? { contextMenu: false, emptyState: false, order: 0 }) },
        }))
        .sort((left, right) => left.preference.order - right.preference.order)
      const index = ordered.findIndex(panel => panel.id === id)
      const adjacent = ordered[index + (direction === 'earlier' ? -1 : 1)]
      if (index === -1 || adjacent === undefined) return false
      const current = ordered[index]
      if (current === undefined) return false
      const currentOrder = current.preference.order
      current.preference.order = adjacent.preference.order
      adjacent.preference.order = currentOrder
      storedPanelPreferences.set({
        ...storedPanelPreferences.get(),
        [current.id]: current.preference,
        [adjacent.id]: adjacent.preference,
      })
      notify()
      return true
    },
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
  /** Native-aside capabilities remain available even before Workbench itself activates. */
  var dshfilesWorkbenchNativeAsideOwnersV1: Map<string, () => boolean> | undefined
}

const nativeAsideOwners = (): Map<string, () => boolean> => (globalThis.dshfilesWorkbenchNativeAsideOwnersV1 ??= new Map())

/** Explicit native admission, independent of generic Workbench panel projections and listener order. */
export class NativeAsideOwners {
  static register(mainPanelId: string, open: () => boolean): () => void {
    const owners = nativeAsideOwners()
    owners.set(mainPanelId, open)
    return () => {
      if (owners.get(mainPanelId) === open) owners.delete(mainPanelId)
    }
  }

  static request(mainPanelId: string): 'unowned' | 'accepted' | 'declined' {
    const open = nativeAsideOwners().get(mainPanelId)
    return open === undefined ? 'unowned' : open() ? 'accepted' : 'declined'
  }
}

/**
 * The page-wide registry. Each plugin bundle inlines this module, so the instance lives on `globalThis`: whichever
 * bundle loads first creates it, and contributors may register before the workbench loads.
 */
export const workbenchPanels = (): WorkbenchPanelRegistry => (globalThis.dshfilesWorkbenchPanelsV1 ??= createWorkbenchPanelRegistry())

/**
 * A person's name for one main panel's tab, without the "Plugin: View" prefix its navigation label carries
 * (plan `docs/ade-ux` §5: labels never show plugin names). The workbench owns the tab titles, so it declares the
 * registry (`@dshfiles/workbench/panel-titles`); a plugin that knows better names (main-tabs, from the shell's
 * destination sections) provides entries. Without an entry the title is the navigation label with any `Plugin: `
 * prefix removed.
 */
export interface PanelTitle {
  readonly panelId: string
  readonly title: string
}

/** "Usage: Analytics" → "Analytics"; a label without a prefix is kept. */
export const withoutPluginPrefix = (label: string): string => {
  const index = label.indexOf(': ')
  return index > 0 && index < label.length - 2 ? label.slice(index + 2) : label
}

/** The tab title of one main panel: a provided title, else its navigation label without the plugin prefix. */
export const panelTabTitle = (panelId: string, label: string | undefined, provided: readonly PanelTitle[]): string | undefined => {
  const named = provided.findLast(entry => entry.panelId === panelId)?.title
  if (named !== undefined) return named
  return label === undefined ? undefined : withoutPluginPrefix(label)
}
