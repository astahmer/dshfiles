/**
 * Sidebar folders (b:952m): the rail is a list of folders of plugin panels the user can extend. The eight destinations
 * are built-in folders (hideable, never deleted); a person adds folders of their own and files any addable panel (a
 * page, a thread facet, a plugin view) into any folder.
 *
 * Only the person's changes are stored, in the sidebar's Host-synced settings (`sidebarTree`). An empty tree is the
 * default: every page lands in the folder its destination mapping names, so a page a plugin adds later still appears.
 * A panel filed explicitly in a folder lives only there; a mapped page someone removed is listed in `removed`. A
 * deleted user folder is kept as a tombstone for 30 days so it can be restored with its panels.
 *
 * Pure: the Host runs the verbs on the stored tree; the browser resolves the stored tree against the pages and views
 * it has (`resolve`). No React, no Effect services.
 */
import * as Schema from 'effect/Schema'
import { DESTINATION_IDS, type DestinationId } from './destination-ids.js'

export const BUILT_IN_FOLDER_IDS: readonly DestinationId[] = DESTINATION_IDS

/** A deleted folder can be restored for this long. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FOLDERS = 40
const MAX_ENTRIES = 100
const MAX_REMOVED = 300
const MAX_TOMBSTONES = 20

export const folderIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/u))
/** A Workbench view id or a main page id: the same grammar the Workbench registry accepts. */
export const viewIdSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u))
export const folderTitleSchema = Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(40))
/** A lucide icon name in kebab case (`folder`, `git-pull-request`); the browser falls back to a folder glyph. */
export const folderIconSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/u))

const entrySchema = Schema.Struct({ viewId: viewIdSchema, keep: Schema.Boolean })
const folderSchema = Schema.Struct({
  id: folderIdSchema,
  title: folderTitleSchema,
  icon: folderIconSchema,
  builtIn: Schema.Boolean,
  hidden: Schema.Boolean,
  entries: Schema.Array(entrySchema).check(Schema.isMaxLength(MAX_ENTRIES)),
})
const tombstoneSchema = Schema.Struct({
  folder: folderSchema,
  index: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  deletedAt: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
})

export const sidebarTreeSchema = Schema.Struct({
  /** Bumped by every change, so a browser can tell a tree apart from the one it rendered. */
  revision: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  /** Empty: the default (every built-in folder in rail order, every page in its mapped folder). */
  folders: Schema.Array(folderSchema).check(Schema.isMaxLength(MAX_FOLDERS)),
  removed: Schema.Array(viewIdSchema).check(Schema.isMaxLength(MAX_REMOVED)),
  tombstones: Schema.Array(tombstoneSchema).check(Schema.isMaxLength(MAX_TOMBSTONES)),
})

export type SidebarTree = typeof sidebarTreeSchema.Type
export type SidebarFolder = SidebarTree['folders'][number]
export type SidebarEntry = SidebarFolder['entries'][number]
export type SidebarTombstone = SidebarTree['tombstones'][number]

export const EMPTY_SIDEBAR_TREE: SidebarTree = { revision: 0, folders: [], removed: [], tombstones: [] }

/** Built-in folder titles and icons; the rail reads its own labels, the Host needs them only to materialize a tree. */
const BUILT_IN = {
  threads: { title: 'Threads', icon: 'messages-square' },
  inbox: { title: 'Inbox', icon: 'inbox' },
  land: { title: 'Land', icon: 'git-merge' },
  work: { title: 'Work', icon: 'list-todo' },
  agents: { title: 'Agents', icon: 'bot' },
  observe: { title: 'Observe', icon: 'activity' },
  knowledge: { title: 'Knowledge', icon: 'library' },
  settings: { title: 'Settings', icon: 'settings' },
} as const satisfies Record<DestinationId, { readonly title: string; readonly icon: string }>

const isBuiltIn = (id: string): id is DestinationId => BUILT_IN_FOLDER_IDS.some(builtIn => builtIn === id)

const builtInFolder = (id: DestinationId): SidebarFolder => ({
  id,
  title: BUILT_IN[id].title,
  icon: BUILT_IN[id].icon,
  builtIn: true,
  hidden: false,
  entries: [],
})

/** Why a verb refused: the Host maps each reason to a typed error with a recovery path. */
export type SidebarTreeRefusal =
  | { readonly reason: 'folder-not-found'; readonly id: string }
  | { readonly reason: 'built-in'; readonly id: string }
  | { readonly reason: 'folder-limit' }
  | { readonly reason: 'entry-limit'; readonly id: string }
  | { readonly reason: 'not-in-sidebar'; readonly viewId: string }
  | { readonly reason: 'tombstone-not-found'; readonly id: string }

export type SidebarTreeResult = { readonly ok: true; readonly tree: SidebarTree } | { readonly ok: false; readonly refusal: SidebarTreeRefusal }

const ok = (tree: SidebarTree): SidebarTreeResult => ({ ok: true, tree })
const refuse = (refusal: SidebarTreeRefusal): SidebarTreeResult => ({ ok: false, refusal })

/**
 * Every built-in folder present once (missing ones keep their rail position), every view filed at most once (first
 * wins), removed views not filed, expired tombstones pruned.
 */
const normalize = (tree: SidebarTree, now: number): SidebarTree => {
  if (tree.folders.length === 0 && tree.removed.length === 0 && tree.tombstones.length === 0) return tree
  const seenFolders = new Set<string>()
  const seenViews = new Set<string>()
  const folders: SidebarFolder[] = []
  for (const folder of tree.folders) {
    if (seenFolders.has(folder.id)) continue
    seenFolders.add(folder.id)
    const entries = folder.entries.filter(entry => {
      if (seenViews.has(entry.viewId)) return false
      seenViews.add(entry.viewId)
      return true
    })
    folders.push({ ...folder, builtIn: isBuiltIn(folder.id), hidden: isBuiltIn(folder.id) ? folder.hidden : false, entries })
  }
  if (folders.length > 0)
    BUILT_IN_FOLDER_IDS.forEach((id, index) => {
      if (seenFolders.has(id)) return
      // Right after the previous built-in that is present (first when none is), so the rail order survives.
      const previous = BUILT_IN_FOLDER_IDS.slice(0, index).findLast(earlier => seenFolders.has(earlier))
      const at = previous === undefined ? 0 : folders.findIndex(folder => folder.id === previous) + 1
      folders.splice(at, 0, builtInFolder(id))
      seenFolders.add(id)
    })
  return {
    revision: tree.revision,
    folders,
    removed: [...new Set(tree.removed)].filter(viewId => !seenViews.has(viewId)),
    tombstones: tree.tombstones.filter(tombstone => now - tombstone.deletedAt < TOMBSTONE_RETENTION_MS && !seenFolders.has(tombstone.folder.id)),
  }
}

/** The stored folders, or the built-in ones in rail order when nothing is stored yet. */
const materialize = (tree: SidebarTree): SidebarFolder[] => (tree.folders.length > 0 ? [...tree.folders] : BUILT_IN_FOLDER_IDS.map(builtInFolder))

const bumped = (tree: SidebarTree, next: Omit<SidebarTree, 'revision'>, now: number): SidebarTree => normalize({ ...next, revision: tree.revision + 1 }, now)

/** A user folder id from its title, unique among the folders and tombstones. */
const folderIdFor = (tree: SidebarTree, title: string): string => {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40) || 'folder'
  const taken = new Set([...materialize(tree).map(folder => folder.id), ...tree.tombstones.map(tombstone => tombstone.folder.id)])
  const prefixed = isBuiltIn(base) ? `my-${base}` : base
  if (!taken.has(prefixed)) return prefixed
  for (let suffix = 2; ; suffix += 1) if (!taken.has(`${prefixed}-${String(suffix)}`)) return `${prefixed}-${String(suffix)}`
}

const indexBefore = (folders: readonly SidebarFolder[], beforeId: string | null | undefined): number | undefined => {
  if (beforeId === null || beforeId === undefined) {
    // New and moved folders go above Settings, which the rail pins to the bottom.
    const settings = folders.findIndex(folder => folder.id === 'settings')
    return settings === -1 ? folders.length : settings
  }
  const index = folders.findIndex(folder => folder.id === beforeId)
  return index === -1 ? undefined : index
}

const withoutView = (folders: readonly SidebarFolder[], viewId: string): SidebarFolder[] =>
  folders.map(folder =>
    folder.entries.some(entry => entry.viewId === viewId) ? { ...folder, entries: folder.entries.filter(entry => entry.viewId !== viewId) } : folder,
  )

const placedIn = (folders: readonly SidebarFolder[], viewId: string): SidebarFolder | undefined =>
  folders.find(folder => folder.entries.some(entry => entry.viewId === viewId))

export class SidebarTreeModel {
  static readonly normalize = normalize
  static readonly materialize = materialize

  static createFolder(
    tree: SidebarTree,
    input: { readonly title: string; readonly icon?: string | undefined; readonly beforeId?: string | null | undefined },
    now: number,
  ) {
    const folders = materialize(tree)
    if (folders.length >= MAX_FOLDERS) return { result: refuse({ reason: 'folder-limit' }), id: undefined }
    const at = indexBefore(folders, input.beforeId)
    if (at === undefined) return { result: refuse({ reason: 'folder-not-found', id: input.beforeId ?? '' }), id: undefined }
    const id = folderIdFor(tree, input.title)
    folders.splice(at, 0, { id, title: input.title, icon: input.icon ?? 'folder', builtIn: false, hidden: false, entries: [] })
    return { result: ok(bumped(tree, { ...tree, folders }, now)), id }
  }

  /** Rename, re-icon, hide or show one folder; a built-in folder can be hidden but keeps its title. */
  static updateFolder(
    tree: SidebarTree,
    input: { readonly id: string; readonly title?: string | undefined; readonly icon?: string | undefined; readonly hidden?: boolean | undefined },
    now: number,
  ): SidebarTreeResult {
    const folders = materialize(tree)
    const index = folders.findIndex(folder => folder.id === input.id)
    const folder = folders[index]
    if (folder === undefined) return refuse({ reason: 'folder-not-found', id: input.id })
    if (folder.builtIn && (input.title !== undefined || input.icon !== undefined)) return refuse({ reason: 'built-in', id: input.id })
    if (!folder.builtIn && input.hidden === true) return refuse({ reason: 'built-in', id: input.id })
    folders[index] = { ...folder, title: input.title ?? folder.title, icon: input.icon ?? folder.icon, hidden: input.hidden ?? folder.hidden }
    return ok(bumped(tree, { ...tree, folders }, now))
  }

  /** Move one folder before another, or above Settings at the end (`beforeId` null). */
  static moveFolder(tree: SidebarTree, input: { readonly id: string; readonly beforeId?: string | null | undefined }, now: number): SidebarTreeResult {
    const folders = materialize(tree)
    const index = folders.findIndex(folder => folder.id === input.id)
    const folder = folders[index]
    if (folder === undefined) return refuse({ reason: 'folder-not-found', id: input.id })
    folders.splice(index, 1)
    const at = indexBefore(folders, input.beforeId)
    if (at === undefined) return refuse({ reason: 'folder-not-found', id: input.beforeId ?? '' })
    folders.splice(at, 0, folder)
    return ok(bumped(tree, { ...tree, folders }, now))
  }

  /**
   * Delete one user folder: it becomes a tombstone (restorable for 30 days) and its panels move to Settings › Other
   * pages, so nothing filed in it leaves the sidebar.
   */
  static deleteFolder(tree: SidebarTree, input: { readonly id: string }, now: number): SidebarTreeResult {
    const folders = materialize(tree)
    const index = folders.findIndex(folder => folder.id === input.id)
    const folder = folders[index]
    if (folder === undefined) return refuse({ reason: 'folder-not-found', id: input.id })
    if (folder.builtIn) return refuse({ reason: 'built-in', id: input.id })
    folders.splice(index, 1)
    const settings = folders.findIndex(candidate => candidate.id === 'settings')
    const target = folders[settings]
    if (target !== undefined) folders[settings] = { ...target, entries: [...target.entries, ...folder.entries].slice(0, MAX_ENTRIES) }
    const tombstones = [{ folder, index, deletedAt: now }, ...tree.tombstones.filter(tombstone => tombstone.folder.id !== folder.id)].slice(0, MAX_TOMBSTONES)
    return ok(bumped(tree, { ...tree, folders, tombstones }, now))
  }

  /** Restore a deleted folder at its old place with its panels, taking them back from wherever they went. */
  static restoreFolder(tree: SidebarTree, input: { readonly id: string }, now: number): SidebarTreeResult {
    const tombstone = tree.tombstones.find(candidate => candidate.folder.id === input.id && now - candidate.deletedAt < TOMBSTONE_RETENTION_MS)
    if (tombstone === undefined) return refuse({ reason: 'tombstone-not-found', id: input.id })
    let folders = materialize(tree)
    for (const entry of tombstone.folder.entries) folders = withoutView(folders, entry.viewId)
    if (folders.some(folder => folder.id === tombstone.folder.id)) return refuse({ reason: 'tombstone-not-found', id: input.id })
    folders.splice(Math.min(tombstone.index, folders.length), 0, tombstone.folder)
    const removed = tree.removed.filter(viewId => !tombstone.folder.entries.some(entry => entry.viewId === viewId))
    const tombstones = tree.tombstones.filter(candidate => candidate !== tombstone)
    return ok(bumped(tree, { ...tree, folders, removed, tombstones }, now))
  }

  /**
   * File one panel in a folder (before another of its panels, or at the end), taking it out of any other folder. Adding
   * a panel already in that folder only updates its keep flag and place.
   */
  static addPanel(
    tree: SidebarTree,
    input: { readonly viewId: string; readonly folderId: string; readonly keep?: boolean | undefined; readonly beforeViewId?: string | null | undefined },
    now: number,
  ): SidebarTreeResult {
    const current = placedIn(materialize(tree), input.viewId)?.entries.find(entry => entry.viewId === input.viewId)
    const folders = withoutView(materialize(tree), input.viewId)
    const index = folders.findIndex(folder => folder.id === input.folderId)
    const folder = folders[index]
    if (folder === undefined) return refuse({ reason: 'folder-not-found', id: input.folderId })
    if (folder.entries.length >= MAX_ENTRIES) return refuse({ reason: 'entry-limit', id: input.folderId })
    const entry = { viewId: input.viewId, keep: input.keep ?? current?.keep ?? false }
    const before = input.beforeViewId === null || input.beforeViewId === undefined ? -1 : folder.entries.findIndex(item => item.viewId === input.beforeViewId)
    const entries = [...folder.entries]
    entries.splice(before === -1 ? entries.length : before, 0, entry)
    folders[index] = { ...folder, entries }
    return ok(bumped(tree, { ...tree, folders, removed: tree.removed.filter(viewId => viewId !== input.viewId) }, now))
  }

  /** Move one filed panel to another folder or place; the same as adding it there, but it must already be filed. */
  static movePanel(
    tree: SidebarTree,
    input: { readonly viewId: string; readonly folderId: string; readonly beforeViewId?: string | null | undefined },
    now: number,
    /** A mapped page the browser shows by default counts as filed in its folder. */
    mapped = false,
  ): SidebarTreeResult {
    if (!mapped && placedIn(materialize(tree), input.viewId) === undefined) return refuse({ reason: 'not-in-sidebar', viewId: input.viewId })
    return SidebarTreeModel.addPanel(tree, input, now)
  }

  /** Take one panel out of the sidebar: a filed one leaves its folder; a mapped page is listed as removed. */
  static removePanel(tree: SidebarTree, input: { readonly viewId: string }, now: number, mapped = false): SidebarTreeResult {
    const folders = materialize(tree)
    const filed = placedIn(folders, input.viewId) !== undefined
    if (!filed && !mapped) return refuse({ reason: 'not-in-sidebar', viewId: input.viewId })
    const removed = mapped && !tree.removed.includes(input.viewId) ? [...tree.removed, input.viewId] : tree.removed
    return ok(bumped(tree, { ...tree, folders: withoutView(folders, input.viewId), removed }, now))
  }

  /** Back to the default: every built-in folder, every page in its mapped folder; tombstones of user folders stay. */
  static reset(tree: SidebarTree, now: number): SidebarTree {
    const index = (id: string): number =>
      Math.max(
        0,
        materialize(tree).findIndex(folder => folder.id === id),
      )
    const userFolders = materialize(tree).filter(folder => !folder.builtIn)
    const tombstones = [...userFolders.map(folder => ({ folder, index: index(folder.id), deletedAt: now })), ...tree.tombstones].slice(0, MAX_TOMBSTONES)
    return { revision: tree.revision + 1, folders: [], removed: [], tombstones }
  }

  static readonly isBuiltIn = isBuiltIn
}

/** One row the rail shows inside a folder. */
export interface ResolvedEntry {
  readonly viewId: string
  readonly title: string
  readonly kind: SidebarPanelKind
  readonly keep: boolean
  /** Shown here by the destination mapping, not filed by the person. */
  readonly mapped: boolean
  /** The section the mapping gave it (its description, its former labels); undefined for a filed non-page view. */
  readonly description?: string | undefined
  /** A mapped page nobody mapped explicitly: Settings › Other pages. */
  readonly unmapped: boolean
}

export interface ResolvedFolder {
  readonly id: string
  readonly title: string
  readonly icon: string
  readonly builtIn: boolean
  readonly hidden: boolean
  readonly entries: readonly ResolvedEntry[]
}

export const SIDEBAR_PANEL_KINDS = ['page', 'facet', 'view'] as const
export type SidebarPanelKind = (typeof SIDEBAR_PANEL_KINDS)[number]

/** One panel this browser can show: a main page, a thread facet or another Workbench view. */
export interface SidebarPanel {
  readonly id: string
  readonly title: string
  readonly kind: SidebarPanelKind
}

export const sidebarPanelSchema = Schema.Struct({
  id: viewIdSchema,
  title: Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(120)),
  kind: Schema.Literals(SIDEBAR_PANEL_KINDS),
})

/** A mapped page as the destination mapping lists it (see destinations.ts). */
export interface MappedSection {
  readonly panelId: string
  readonly destination: DestinationId
  readonly label: string
  readonly description?: string | undefined
  readonly unmapped: boolean
}

/**
 * The rail's folders for this browser: the stored folders (or the built-in ones), each with its filed panels first and
 * then, for a built-in folder, the mapped pages nobody filed or removed. A filed panel this browser cannot show (its
 * plugin is not loaded) is skipped, not dropped from the tree.
 */
const resolve = (input: {
  readonly tree: SidebarTree
  readonly sections: readonly MappedSection[]
  readonly panels: readonly SidebarPanel[]
}): readonly ResolvedFolder[] => {
  const folders = materialize(input.tree)
  const filed = new Set(folders.flatMap(folder => folder.entries.map(entry => entry.viewId)))
  const removed = new Set(input.tree.removed)
  const panels = new Map(input.panels.map(panel => [panel.id, panel]))
  const sections = new Map(input.sections.map(section => [section.panelId, section]))
  return folders.map(folder => {
    const explicit = folder.entries.flatMap((entry): ResolvedEntry[] => {
      const section = sections.get(entry.viewId)
      const panel = panels.get(entry.viewId)
      if (section === undefined && panel === undefined) return []
      return [
        {
          viewId: entry.viewId,
          title: section?.label ?? panel?.title ?? entry.viewId,
          kind: panel?.kind ?? 'page',
          keep: entry.keep,
          mapped: false,
          description: section?.description,
          unmapped: false,
        },
      ]
    })
    const mapped = folder.builtIn
      ? input.sections
          .filter(section => section.destination === folder.id && !filed.has(section.panelId) && !removed.has(section.panelId))
          .map((section): ResolvedEntry => ({
            viewId: section.panelId,
            title: section.label,
            kind: 'page',
            keep: false,
            mapped: true,
            description: section.description,
            unmapped: section.unmapped,
          }))
      : []
    return { id: folder.id, title: folder.title, icon: folder.icon, builtIn: folder.builtIn, hidden: folder.hidden, entries: [...explicit, ...mapped] }
  })
}

export class SidebarTrees {
  static readonly resolve = resolve
  /** The folder a view shows in for this browser, filed or mapped. */
  static folderOf(folders: readonly ResolvedFolder[], viewId: string): ResolvedFolder | undefined {
    return folders.find(folder => folder.entries.some(entry => entry.viewId === viewId))
  }
}
