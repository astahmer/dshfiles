import { Clock, Context, Effect, Layer, Option, Ref, Schedule, Schema, Semaphore } from 'effect'
import { KNOWN_SECTIONS } from './known-sections.js'
import { SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { ThreadSidebarSettings } from './sidebar-settings.js'
import {
  EMPTY_SIDEBAR_TREE,
  SidebarTreeModel,
  sidebarTreeSchema,
  type SidebarPanel,
  type SidebarTree,
  type SidebarTreeRefusal,
  type SidebarTreeResult,
} from './sidebar-tree.js'
import type {
  sidebarFolderCreateSchema,
  sidebarFolderDeleteSchema,
  sidebarFolderMoveSchema,
  sidebarFolderRestoreSchema,
  sidebarFolderUpdateSchema,
  sidebarPanelAddSchema,
  sidebarPanelMoveSchema,
  sidebarPanelRemoveSchema,
  sidebarPanelsReportSchema,
} from './sidebar-tree-api.js'

const MAX_ISSUE = 500
/** A write that lost a race with another writer is recomputed on a fresh read (the verbs are pure on the tree). */
const CONFLICT_RETRY = { schedule: Schedule.spaced('50 millis'), times: 20 } as const
/** Browsers that stopped reporting this long ago no longer count toward the available panels. */
const REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BROWSERS = 20

/** A sidebar folder verb refused: the folder or panel is not there, or a built-in folder cannot change that way. */
export class SidebarTreeRefused extends Schema.TaggedError<SidebarTreeRefused>()(
  'SidebarTreeRefused',
  {
    reason: Schema.Literals(['folder-not-found', 'built-in', 'folder-limit', 'entry-limit', 'not-in-sidebar', 'tombstone-not-found']),
    target: Schema.String.check(Schema.isMaxLength(200)),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'sidebar-tree-refused' },
) {
  override get message(): string {
    const target = JSON.stringify(this.target)
    switch (this.reason) {
      case 'folder-not-found':
        return `No sidebar folder ${target}. Read the folders with sidebar_tree_get and pick an existing id.`
      case 'built-in':
        return `${target} is a built-in folder or cannot change that way: built-in folders can only be hidden or shown, user folders are deleted instead of hidden.`
      case 'folder-limit':
        return 'The sidebar holds 40 folders already. Delete or merge a folder first.'
      case 'entry-limit':
        return `Folder ${target} holds 100 panels already. File the panel in another folder.`
      case 'not-in-sidebar':
        return `${target} is not in the sidebar. Add it with sidebar_panel_add instead.`
      case 'tombstone-not-found':
        return `No deleted folder ${target} can be restored (deletes are kept for 30 days). Read sidebar_tree_get for the restorable ones.`
    }
  }
}

/** The stored sidebar tree does not decode: it was written by a newer or broken client. */
export class SidebarTreeInvalid extends Schema.TaggedError<SidebarTreeInvalid>()(
  'SidebarTreeInvalid',
  { issue: Schema.String.check(Schema.isMaxLength(MAX_ISSUE)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sidebar-tree-invalid' },
) {
  override get message(): string {
    return `The saved sidebar folders are not valid (${this.issue}). Reset them with sidebar_tree_reset, or fix the thread-sidebar sidebarTree setting.`
  }
}

type TreeRead = { readonly tree: SidebarTree; readonly derived: boolean }
type TreeWriteFailure = SidebarTreeRefused | SidebarTreeInvalid | SidebarSettingsWriteFailed

const decodeTree = Schema.decodeUnknownEffect(sidebarTreeSchema)

const refusedFrom = (refusal: SidebarTreeRefusal): SidebarTreeRefused =>
  new SidebarTreeRefused({
    reason: refusal.reason,
    target: 'id' in refusal ? refusal.id : 'viewId' in refusal ? refusal.viewId : '',
  })

const isDerived = (tree: SidebarTree): boolean => tree.folders.length === 0 && tree.removed.length === 0

interface Report {
  readonly at: number
  readonly panels: readonly SidebarPanel[]
}

/**
 * The rail's folders (b:952m), stored as `sidebarTree` in the sidebar's settings namespace. Writes are serialized,
 * written against the revision they read, and recomputed on a conflict, since every verb is a pure function of the
 * tree. The panels browsers can show are kept in memory, last report per browser.
 */
export class SidebarTrees extends Context.Service<
  SidebarTrees,
  {
    readonly get: Effect.Effect<TreeRead, SidebarTreeInvalid>
    readonly panelsAvailable: Effect.Effect<{
      readonly panels: readonly SidebarPanel[]
      readonly reportedAt: number | null
      readonly browsers: number
      readonly note: string
    }>
    readonly reportPanels: (input: typeof sidebarPanelsReportSchema.Type) => Effect.Effect<{ readonly accepted: boolean }>
    readonly folderCreate: (input: typeof sidebarFolderCreateSchema.Type) => Effect.Effect<TreeRead & { readonly folderId: string }, TreeWriteFailure>
    readonly folderUpdate: (input: typeof sidebarFolderUpdateSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly folderMove: (input: typeof sidebarFolderMoveSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly folderDelete: (input: typeof sidebarFolderDeleteSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly folderRestore: (input: typeof sidebarFolderRestoreSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly panelAdd: (input: typeof sidebarPanelAddSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly panelMove: (input: typeof sidebarPanelMoveSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly panelRemove: (input: typeof sidebarPanelRemoveSchema.Type) => Effect.Effect<TreeRead, TreeWriteFailure>
    readonly reset: Effect.Effect<TreeRead, TreeWriteFailure>
  }
>()('@dshfiles/thread-sidebar/SidebarTrees') {
  static readonly layer = Layer.effect(
    SidebarTrees,
    Effect.gen(function* () {
      const settings = yield* ThreadSidebarSettings
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)
      // The settings snapshot refreshes when DSH announces the commit; until then this process's own last write is newer.
      const ownWrite = yield* Ref.make(Option.none<{ readonly tree: SidebarTree; readonly revision: number }>())
      const reports = yield* Ref.make(new Map<string, Report>())

      const read = Effect.gen(function* () {
        const snapshot = yield* settings.snapshot
        const own = yield* Ref.get(ownWrite)
        if (Option.isSome(own) && own.value.revision > snapshot.revision) return { tree: own.value.tree, revision: own.value.revision }
        // An older Host schema without the field, or a default `{}`, reads as the empty (default) tree.
        const stored: unknown = snapshot.value.sidebarTree
        const value = stored === undefined || stored === null || (typeof stored === 'object' && Object.keys(stored).length === 0) ? EMPTY_SIDEBAR_TREE : stored
        const tree = yield* decodeTree(value).pipe(Effect.mapError(cause => new SidebarTreeInvalid({ issue: cause.message.slice(0, MAX_ISSUE), cause })))
        return { tree, revision: snapshot.revision }
      })

      const get = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const { tree } = yield* read
        const normalized = SidebarTreeModel.normalize(tree, now)
        return { tree: normalized, derived: isDerived(normalized) }
      })

      /** Pages show in a folder by default (mapped, or under Settings › Other pages): the browsers' reports and the table. */
      const knownPages = Effect.map(Ref.get(reports), current => {
        const pages = new Set(KNOWN_SECTIONS.map(section => section.panelId))
        for (const report of current.values()) for (const panel of report.panels) if (panel.kind === 'page') pages.add(panel.id)
        return pages
      })

      const change = (operation: (tree: SidebarTree, now: number, pages: ReadonlySet<string>) => SidebarTreeResult) =>
        exclusive(
          Effect.gen(function* () {
            const current = yield* read
            const now = yield* Clock.currentTimeMillis
            const result = operation(current.tree, now, yield* knownPages)
            if (!result.ok) return yield* refusedFrom(result.refusal)
            yield* settings.update({ sidebarTree: result.tree }, current.revision)
            yield* Ref.set(ownWrite, Option.some({ tree: result.tree, revision: current.revision + 1 }))
            return { tree: result.tree, derived: isDerived(result.tree) }
          }).pipe(
            Effect.retry({ ...CONFLICT_RETRY, while: error => error._tag === 'SettingsConflict' }),
            Effect.catchTags({
              SettingsConflict: cause => Effect.fail(new SidebarSettingsWriteFailed({ cause })),
              SettingsWriteFailed: cause => Effect.fail(new SidebarSettingsWriteFailed({ cause })),
            }),
          ),
        )

      return SidebarTrees.of({
        get: get.pipe(Effect.withSpan('sidebar tree get')),
        panelsAvailable: Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const live = [...(yield* Ref.get(reports)).values()].filter(report => now - report.at < REPORT_TTL_MS)
          const panels = new Map<string, SidebarPanel>()
          for (const report of live.sort((left, right) => left.at - right.at)) for (const panel of report.panels) panels.set(panel.id, panel)
          const reportedAt = live.length === 0 ? null : Math.max(...live.map(report => report.at))
          return {
            panels: [...panels.values()].sort((left, right) => left.title.localeCompare(right.title)),
            reportedAt,
            browsers: live.length,
            note:
              reportedAt === null
                ? 'No browser has reported its panels since DSH started. Open the DSH page once, then ask again.'
                : 'The panels the open DSH pages can show, as they last reported them.',
          }
        }).pipe(Effect.withSpan('sidebar tree panels available')),
        reportPanels: Effect.fn('sidebar tree report panels')(function* (input) {
          const now = yield* Clock.currentTimeMillis
          yield* Ref.update(reports, current => {
            const next = new Map(current)
            next.set(input.browserId, { at: now, panels: input.panels })
            // Keep the newest browsers only: reports are best effort, never an unbounded store.
            const newest = [...next.entries()].sort(([, left], [, right]) => right.at - left.at).slice(0, MAX_BROWSERS)
            return new Map(newest)
          })
          return { accepted: true }
        }),
        folderCreate: Effect.fn('sidebar tree folder create')(function* (input) {
          let folderId = ''
          const written = yield* change((tree, now) => {
            const created = SidebarTreeModel.createFolder(tree, input, now)
            folderId = created.id ?? ''
            return created.result
          })
          return { ...written, folderId }
        }),
        folderUpdate: Effect.fn('sidebar tree folder update')(function* (input) {
          return yield* change((tree, now) => SidebarTreeModel.updateFolder(tree, input, now))
        }),
        folderMove: Effect.fn('sidebar tree folder move')(function* (input) {
          return yield* change((tree, now) => SidebarTreeModel.moveFolder(tree, input, now))
        }),
        folderDelete: Effect.fn('sidebar tree folder delete')(function* (input) {
          return yield* change((tree, now) => SidebarTreeModel.deleteFolder(tree, input, now))
        }),
        folderRestore: Effect.fn('sidebar tree folder restore')(function* (input) {
          return yield* change((tree, now) => SidebarTreeModel.restoreFolder(tree, input, now))
        }),
        panelAdd: Effect.fn('sidebar tree panel add')(function* (input) {
          return yield* change((tree, now) => SidebarTreeModel.addPanel(tree, input, now))
        }),
        panelMove: Effect.fn('sidebar tree panel move')(function* (input) {
          return yield* change((tree, now, pages) => SidebarTreeModel.movePanel(tree, input, now, pages.has(input.viewId)))
        }),
        panelRemove: Effect.fn('sidebar tree panel remove')(function* (input) {
          return yield* change((tree, now, pages) => SidebarTreeModel.removePanel(tree, input, now, pages.has(input.viewId)))
        }),
        reset: change((tree, now) => ({ ok: true, tree: SidebarTreeModel.reset(tree, now) })).pipe(Effect.withSpan('sidebar tree reset')),
      })
    }),
  )
}
