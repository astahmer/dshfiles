/**
 * One sidebar layout (b:952m): the Fixed and Free docking left columns merged into one docking region whose default
 * arrangement is the old Fixed rail and list, as one pane (`SIDEBAR_PANE_ID`) whose tab row is hidden.
 *
 * The sidebar owns which layout a person used before the merge (its Host-synced `layoutMode`); the Workbench owns the
 * left layout and the named layouts, which live in this browser. The sidebar files one request per page here and the
 * Workbench applies it once per browser:
 * - formerly Fixed: a left layout this browser still kept from an earlier Free docking session is saved as the named
 *   layout `SHELL_MERGE_BACKUP_NAME`, and the left region starts from the default;
 * - formerly Free docking: the left layout is kept verbatim (it already carries the movable panes), and the first
 *   browser to migrate turns the main tab rows back on, as Free docking always showed them.
 *
 * The request lives on `globalThis` like the panel registry, so it works whichever bundle loads first.
 */
import type { SerializedDockview } from 'dockview-react'
import type { SavedLayoutMap } from './saved-layouts.js'

/** The thread sidebar's rail-and-list pane: the left region's default, and its only pane in a fresh profile. */
export const SIDEBAR_PANE_ID = 'dshfiles-thread-sidebar.workbench-sidebar'

/** The named layout a formerly Fixed browser's dormant Free docking arrangement is kept under. */
export const SHELL_MERGE_BACKUP_NAME = 'Free docking (before merge)'

export type FormerShellLayout = 'fixed' | 'docking'

export interface ShellMergeRequest {
  /** The layout the person used before the merge, as the sidebar's Host settings recorded it. */
  readonly former: FormerShellLayout
  /** True only for the one page that writes the Host marker: Host-synced settings change once, not per browser. */
  readonly firstOnHost: boolean
}

export interface ShellMergePort {
  /** File the request; a later one replaces an untaken one. */
  readonly request: (request: ShellMergeRequest) => void
  readonly take: () => ShellMergeRequest | undefined
  readonly subscribe: (listener: () => void) => () => void
}

const createShellMergePort = (): ShellMergePort => {
  let pending: ShellMergeRequest | undefined
  const listeners = new Set<() => void>()
  return {
    request: request => {
      pending = request
      for (const listener of [...listeners]) listener()
    },
    take: () => {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the request before clearing it: take hands it over exactly once.
      const taken = pending
      pending = undefined
      return taken
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

declare global {
  /** One merge request per page, shared by the sidebar and the Workbench bundles. */
  var dshfilesWorkbenchShellMergeV1: ShellMergePort | undefined
}

const workbenchShellMerge = (): ShellMergePort => (globalThis.dshfilesWorkbenchShellMergeV1 ??= createShellMergePort())

export interface ShellMergePlan {
  /** The named layouts to write, or undefined when they stay as they are. */
  readonly savedLayouts: SavedLayoutMap | undefined
  /** Drop this browser's left layout so the region opens on the default. */
  readonly resetLeft: boolean
  /** Turn the main tab rows on (Host-synced, so only the first migrating page does it). */
  readonly showMainTabs: boolean
}

export class ShellMerge {
  /**
   * What one browser does with one request. A left layout that already holds the sidebar pane was made after the
   * merge and stays; named layouts are never removed; a backup name already taken is kept, not overwritten.
   */
  static plan(input: {
    readonly request: ShellMergeRequest
    readonly left: SerializedDockview | null
    readonly savedLayouts: Readonly<SavedLayoutMap>
  }): ShellMergePlan {
    const { request, left, savedLayouts } = input
    const showMainTabs = request.former === 'docking' && request.firstOnHost
    if (request.former === 'docking' || left === null || left.panels[SIDEBAR_PANE_ID] !== undefined)
      return { savedLayouts: undefined, resetLeft: false, showMainTabs }
    const backup = savedLayouts[SHELL_MERGE_BACKUP_NAME] === undefined ? { ...savedLayouts, [SHELL_MERGE_BACKUP_NAME]: { left } } : undefined
    return { savedLayouts: backup, resetLeft: true, showMainTabs }
  }
}

/**
 * Keep in sidebar (b:952m): the sidebar asks for a panel to be docked in the left region, as a stacked pane under the
 * Sidebar pane, or taken out again. The id is a Workbench view id or a main page key (its view is found by
 * `mainPanelId`). Requests queue until the left region is mounted; from there the pane moves like any other.
 */
export interface LeftKeepRequest {
  readonly viewId: string
  readonly keep: boolean
}

export interface LeftKeepPort {
  readonly request: (request: LeftKeepRequest) => void
  readonly take: () => readonly LeftKeepRequest[]
  readonly subscribe: (listener: () => void) => () => void
}

const createLeftKeepPort = (): LeftKeepPort => {
  const pending = new Map<string, LeftKeepRequest>()
  const listeners = new Set<() => void>()
  return {
    request: request => {
      // A later request for the same panel replaces an untaken one: only the final intent matters.
      pending.delete(request.viewId)
      pending.set(request.viewId, request)
      for (const listener of [...listeners]) listener()
    },
    take: () => {
      const taken = [...pending.values()]
      pending.clear()
      return taken
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

declare global {
  /** Keep-in-sidebar requests from the sidebar to the Workbench's left region. */
  var dshfilesWorkbenchLeftKeepV1: LeftKeepPort | undefined
}

const workbenchLeftKeep = (): LeftKeepPort => (globalThis.dshfilesWorkbenchLeftKeepV1 ??= createLeftKeepPort())

/** One sidebar folder a pane can be added to (b:952m). */
export interface SidebarFolderTarget {
  readonly id: string
  readonly title: string
}

/**
 * The sidebar provides its folders to the pane tab menu's **Add to sidebar ▸ ‹folder›** (b:952m). The Workbench owns
 * the menu and renders the item only while a provider is registered; the sidebar files the panel through its Host verb.
 */
export interface SidebarFoldersProvider {
  readonly folders: () => readonly SidebarFolderTarget[]
  /** File one panel (a Workbench view id, or a main page key) in a folder. */
  readonly add: (viewId: string, folderId: string) => void
}

interface SidebarFoldersPort {
  provider: SidebarFoldersProvider | undefined
}

declare global {
  /** The sidebar's folder provider for the Workbench pane menus. */
  var dshfilesWorkbenchSidebarFoldersV1: SidebarFoldersPort | undefined
}

const sidebarFoldersPort = (): SidebarFoldersPort => (globalThis.dshfilesWorkbenchSidebarFoldersV1 ??= { provider: undefined })

export class SidebarFolderTargets {
  /** Register the provider; the returned release only clears it while it is still the registered one. */
  static provide(provider: SidebarFoldersProvider): () => void {
    const port = sidebarFoldersPort()
    port.provider = provider
    return () => {
      if (port.provider === provider) port.provider = undefined
    }
  }

  static get(): SidebarFoldersProvider | undefined {
    return sidebarFoldersPort().provider
  }
}

/**
 * Reset layout happened (b:952m). The default left region is the Sidebar pane, so the sidebar shows its thread list
 * again: a Reset is how a person recovers a lost list, and the rail may still sit on a page's destination.
 */
export interface LayoutResetPort {
  readonly notify: () => void
  readonly subscribe: (listener: () => void) => () => void
}

declare global {
  /** Reset layout notifications from the Workbench to the sidebar. */
  var dshfilesWorkbenchLayoutResetV1: LayoutResetPort | undefined
}

const createLayoutResetPort = (): LayoutResetPort => {
  const listeners = new Set<() => void>()
  return {
    notify: () => {
      for (const listener of [...listeners]) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const workbenchLayoutReset = (): LayoutResetPort => (globalThis.dshfilesWorkbenchLayoutResetV1 ??= createLayoutResetPort())

/** The process-wide ports the workbench and the sidebar share across bundle copies. */
export class WorkbenchPorts {
  static readonly shellMerge = workbenchShellMerge
  static readonly leftKeep = workbenchLeftKeep
  static readonly layoutReset = workbenchLayoutReset
}
