import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { folderIconSchema, folderIdSchema, folderTitleSchema, sidebarPanelSchema, sidebarTreeSchema, viewIdSchema } from './sidebar-tree.js'

const revisionSchema = Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))

const treeOutput = Schema.Struct({
  tree: sidebarTreeSchema,
  /** True while nothing is stored: every built-in folder and every page in its mapped folder. */
  derived: Schema.Boolean,
})
const folderOutput = Schema.Struct({ tree: sidebarTreeSchema, derived: Schema.Boolean, folderId: folderIdSchema })

export const sidebarFolderCreateSchema = Schema.Struct({
  title: folderTitleSchema,
  icon: Schema.optional(folderIconSchema),
  /** Place it before this folder; omitted or null, above Settings at the end of the rail. */
  beforeId: Schema.optional(Schema.NullOr(folderIdSchema)),
})
export const sidebarFolderUpdateSchema = Schema.Struct({
  id: folderIdSchema,
  title: Schema.optional(folderTitleSchema),
  icon: Schema.optional(folderIconSchema),
  /** Hide or show a built-in folder (user folders are deleted instead). */
  hidden: Schema.optional(Schema.Boolean),
}).check(Schema.makeFilter(input => (Object.keys(input).length > 1 ? undefined : 'Provide a title, an icon or a visibility change.')))
export const sidebarFolderMoveSchema = Schema.Struct({ id: folderIdSchema, beforeId: Schema.optional(Schema.NullOr(folderIdSchema)) })
export const sidebarFolderDeleteSchema = Schema.Struct({ id: folderIdSchema, confirm: Schema.Literal(true) })
export const sidebarFolderRestoreSchema = Schema.Struct({ id: folderIdSchema })
export const sidebarPanelAddSchema = Schema.Struct({
  viewId: viewIdSchema,
  folderId: folderIdSchema,
  /** Also keep it docked in the sidebar (a stacked pane under the folders), not only as a row. */
  keep: Schema.optional(Schema.Boolean),
  beforeViewId: Schema.optional(Schema.NullOr(viewIdSchema)),
})
export const sidebarPanelMoveSchema = Schema.Struct({
  viewId: viewIdSchema,
  folderId: folderIdSchema,
  beforeViewId: Schema.optional(Schema.NullOr(viewIdSchema)),
})
export const sidebarPanelRemoveSchema = Schema.Struct({ viewId: viewIdSchema })
export const sidebarTreeResetSchema = Schema.Struct({ confirm: Schema.Literal(true) })
export const sidebarPanelsReportSchema = Schema.Struct({
  /** A random id this browser keeps, so each browser's last report replaces only its own. */
  browserId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{8,64}$/u)),
  panels: Schema.Array(sidebarPanelSchema).check(Schema.isMaxLength(500)),
})

const panelsOutput = Schema.Struct({
  panels: Schema.Array(sidebarPanelSchema),
  /** When the newest report arrived (epoch ms); null when no browser reported since this Host started. */
  reportedAt: Schema.NullOr(revisionSchema),
  browsers: revisionSchema,
  note: Schema.String,
})

const render = (result: typeof treeOutput.Type): string =>
  result.derived ? 'The sidebar uses its default folders.' : `${String(result.tree.folders.length)} sidebar folders (revision ${String(result.tree.revision)}).`

/**
 * Sidebar folders (b:952m): the rail's folders of plugin panels, stored in the sidebar's Host settings. The rail and
 * the agent call the same methods; every write has its inverse (create ↔ delete/restore, add ↔ remove, move ↔ move).
 */
export const threadSidebarTreeApi = defineApi({
  id: 'thread-sidebar-tree',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    get: method({
      input: Schema.Struct({}),
      output: treeOutput,
      description:
        'Read the sidebar folders: each folder (built-in destinations and user folders) with its filed panels, the panels removed from their default folder and the deleted folders that can still be restored. derived: true means nothing was changed yet and every page sits in its default folder. Read-only.',
      tool: { name: 'sidebar_tree_get', readOnly: true, render: result => JSON.stringify(result) },
    }),
    panelsAvailable: method({
      input: Schema.Struct({}),
      output: panelsOutput,
      description:
        'List the panels a browser reported it can show (pages, thread facets, plugin views), the ids sidebar_panel_add takes. Empty, with a note, when no browser has reported since the Host started: ask the user to open the DSH page. Read-only.',
      tool: { name: 'sidebar_panels_available', readOnly: true, render: result => JSON.stringify(result) },
    }),
    reportPanels: method({
      input: sidebarPanelsReportSchema,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      description: 'Record the panels this browser can show (sent by the sidebar on change; best effort, the last report per browser wins).',
    }),
    folderCreate: method({
      input: sidebarFolderCreateSchema,
      output: folderOutput,
      description:
        'Create a sidebar folder with a title and an optional lucide icon name, before another folder or above Settings. Undo with sidebar_folder_delete. Call only when the user asked for that folder.',
      tool: { name: 'sidebar_folder_create', render },
    }),
    folderUpdate: method({
      input: sidebarFolderUpdateSchema,
      output: treeOutput,
      description:
        'Rename or re-icon a user folder, or hide or show a built-in folder. Undo with the previous title, icon or visibility. Call only when the user asked for that change.',
      tool: { name: 'sidebar_folder_rename', render },
    }),
    folderMove: method({
      input: sidebarFolderMoveSchema,
      output: treeOutput,
      description:
        'Move a sidebar folder before another folder, or above Settings at the end. Undo by moving it back. Call only when the user asked to reorder folders.',
      tool: { name: 'sidebar_folder_move', render },
    }),
    folderDelete: method({
      input: sidebarFolderDeleteSchema,
      output: treeOutput,
      description:
        'Delete a user folder; its panels move to Settings › Other pages and the folder can be restored for 30 days with sidebar_folder_restore. Built-in folders cannot be deleted (hide them with sidebar_folder_rename). Requires confirm: true. Call only when the user asked to delete that folder.',
      tool: { name: 'sidebar_folder_delete', render },
    }),
    folderRestore: method({
      input: sidebarFolderRestoreSchema,
      output: treeOutput,
      description:
        'Restore a deleted sidebar folder at its old place with its panels (within 30 days of the delete). Call only when the user asked to bring it back.',
      tool: { name: 'sidebar_folder_restore', render },
    }),
    panelAdd: method({
      input: sidebarPanelAddSchema,
      output: treeOutput,
      description:
        'File a panel (an id from sidebar_panels_available) in a sidebar folder, optionally kept docked in the sidebar; it leaves any other folder. Undo with sidebar_panel_remove. Call only when the user asked to add that panel.',
      tool: { name: 'sidebar_panel_add', render },
    }),
    panelMove: method({
      input: sidebarPanelMoveSchema,
      output: treeOutput,
      description: 'Move a panel already in the sidebar to another folder or place. Undo by moving it back. Call only when the user asked to move that panel.',
      tool: { name: 'sidebar_panel_move', render },
    }),
    panelRemove: method({
      input: sidebarPanelRemoveSchema,
      output: treeOutput,
      description:
        'Take a panel out of the sidebar (a page removed from its default folder stays reachable from the palette). Undo with sidebar_panel_add. Call only when the user asked to remove that panel.',
      tool: { name: 'sidebar_panel_remove', render },
    }),
    reset: method({
      input: sidebarTreeResetSchema,
      output: treeOutput,
      description:
        'Reset the sidebar folders to the default (every page in its default folder); user folders become restorable deleted folders for 30 days. Requires confirm: true. Call only when the user asked to reset the sidebar folders.',
      tool: { name: 'sidebar_tree_reset', render },
    }),
  },
})

export type SidebarTreeOutput = typeof treeOutput.Type
