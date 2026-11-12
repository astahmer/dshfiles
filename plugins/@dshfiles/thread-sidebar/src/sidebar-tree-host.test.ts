import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { threadSidebarSettings } from './settings.js'
import { ThreadSidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'
import { sidebarFolderDeleteSchema, sidebarFolderUpdateSchema, sidebarTreeResetSchema } from './sidebar-tree-api.js'
import { SidebarTrees } from './sidebar-tree-host.js'
import { TOMBSTONE_RETENTION_MS } from './sidebar-tree.js'

const defaults = (): SidebarSettingsValue => threadSidebarSettings.schema({})

class Faults extends Context.Service<Faults, { readonly conflictNext: Ref.Ref<number>; readonly failNext: Ref.Ref<boolean> }>()('test/TreeFaults') {
  static readonly layer = Layer.effect(Faults, Effect.all({ conflictNext: Ref.make(0), failNext: Ref.make(false) }))
}

/** Real in-memory settings with revision checks; a fault makes another writer move the revision first, or fails. */
const settingsWithFaults = (initial: SidebarSettingsValue) =>
  Layer.effect(
    ThreadSidebarSettings,
    Effect.gen(function* () {
      const real = yield* ThreadSidebarSettings
      const faults = yield* Faults
      return ThreadSidebarSettings.of({
        ...real,
        update: (patch, expectedRevision) =>
          Effect.gen(function* () {
            if ((yield* Ref.getAndUpdate(faults.conflictNext, count => Math.max(0, count - 1))) > 0) yield* real.update({})
            if (yield* Ref.getAndSet(faults.failNext, false))
              return yield* new Settings.SettingsWriteFailed({ namespace: 'thread-sidebar', operation: 'update', cause: new Error('Persistence failed') })
            return yield* real.update(patch, expectedRevision)
          }),
      })
    }),
  ).pipe(Layer.provide(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', initial)))

const treesLayer = (initial = defaults()) => SidebarTrees.layer.pipe(Layer.provideMerge(settingsWithFaults(initial)), Layer.provideMerge(Faults.layer))

const folderIds = (read: { readonly tree: { readonly folders: readonly { readonly id: string }[] } }) => read.tree.folders.map(folder => folder.id)
const entriesOf = (
  read: { readonly tree: { readonly folders: readonly { readonly id: string; readonly entries: readonly { readonly viewId: string }[] }[] } },
  id: string,
) => read.tree.folders.find(folder => folder.id === id)?.entries.map(entry => entry.viewId)

const decodeStrict = (schema: Schema.Codec<unknown, unknown>, input: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(schema)(input, { onExcessProperty: 'error' }))

describe('Host sidebar folders (b:952m)', () => {
  it.effect('starts derived and round-trips create ↔ delete ↔ restore, keeping the folder’s panels', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      expect(yield* trees.get).toMatchObject({ derived: true, tree: { folders: [] } })
      const created = yield* trees.folderCreate({ title: 'Review', icon: 'git-pull-request' })
      expect(created.folderId).toBe('review')
      expect(folderIds(created)).toEqual(['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge', 'review', 'settings'])
      yield* trees.panelAdd({ viewId: 'dshfiles-changes', folderId: 'review' })
      yield* trees.panelAdd({ viewId: 'dshfiles-backlog-panel', folderId: 'review', keep: true })
      const deleted = yield* trees.folderDelete({ id: 'review', confirm: true })
      expect(folderIds(deleted)).not.toContain('review')
      // Its panels move to Settings › Other pages, so nothing filed leaves the sidebar.
      expect(entriesOf(deleted, 'settings')).toEqual(['dshfiles-changes', 'dshfiles-backlog-panel'])
      expect(deleted.tree.tombstones.map(tombstone => tombstone.folder.id)).toEqual(['review'])
      const restored = yield* trees.folderRestore({ id: 'review' })
      expect(folderIds(restored).indexOf('review')).toBe(7)
      expect(entriesOf(restored, 'review')).toEqual(['dshfiles-changes', 'dshfiles-backlog-panel'])
      expect(entriesOf(restored, 'settings')).toEqual([])
      expect(restored.tree.folders.find(folder => folder.id === 'review')?.entries[1]?.keep).toBe(true)
      expect(restored.tree.tombstones).toEqual([])
    }).pipe(Effect.provide(treesLayer())),
  )

  it.effect('round-trips rename and hide ↔ show, move ↔ move back, add ↔ remove and panel move ↔ move back', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      yield* trees.folderCreate({ title: 'Review' })
      expect((yield* trees.folderUpdate({ id: 'review', title: 'Reviews', icon: 'eye' })).tree.folders.find(folder => folder.id === 'review')).toMatchObject({
        title: 'Reviews',
        icon: 'eye',
      })
      expect((yield* trees.folderUpdate({ id: 'agents', hidden: true })).tree.folders.find(folder => folder.id === 'agents')?.hidden).toBe(true)
      expect((yield* trees.folderUpdate({ id: 'agents', hidden: false })).tree.folders.find(folder => folder.id === 'agents')?.hidden).toBe(false)
      expect(folderIds(yield* trees.folderMove({ id: 'review', beforeId: 'inbox' })).slice(0, 3)).toEqual(['threads', 'review', 'inbox'])
      expect(folderIds(yield* trees.folderMove({ id: 'review', beforeId: null })).at(-2)).toBe('review')
      yield* trees.panelAdd({ viewId: 'traces', folderId: 'review' })
      yield* trees.panelAdd({ viewId: 'usage', folderId: 'review', beforeViewId: 'traces' })
      expect(entriesOf(yield* trees.get, 'review')).toEqual(['usage', 'traces'])
      expect(entriesOf(yield* trees.panelMove({ viewId: 'usage', folderId: 'work' }), 'work')).toEqual(['usage'])
      expect(entriesOf(yield* trees.panelMove({ viewId: 'usage', folderId: 'review', beforeViewId: 'traces' }), 'review')).toEqual(['usage', 'traces'])
      const removed = yield* trees.panelRemove({ viewId: 'traces' })
      expect(entriesOf(removed, 'review')).toEqual(['usage'])
      // Traces is a mapped page (Observe): taking it out of the sidebar lists it as removed, and adding it back clears that.
      expect(removed.tree.removed).toEqual(['traces'])
      const added = yield* trees.panelAdd({ viewId: 'traces', folderId: 'review' })
      expect(added.tree.removed).toEqual([])
      expect(entriesOf(added, 'review')).toEqual(['usage', 'traces'])
    }).pipe(Effect.provide(treesLayer())),
  )

  it.effect('reset returns to the derived default and keeps user folders restorable', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      yield* trees.folderCreate({ title: 'Review' })
      yield* trees.panelAdd({ viewId: 'dshfiles-changes', folderId: 'review' })
      const reset = yield* trees.reset
      expect(reset.derived).toBe(true)
      expect(reset.tree.tombstones.map(tombstone => tombstone.folder.id)).toEqual(['review'])
      expect(entriesOf(yield* trees.folderRestore({ id: 'review' }), 'review')).toEqual(['dshfiles-changes'])
    }).pipe(Effect.provide(treesLayer())),
  )

  it.effect('refuses with a recovery path: built-ins cannot be deleted or renamed, missing targets are named', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      const message = <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) => Effect.map(Effect.flip(effect), error => error.message)
      expect(yield* message(trees.folderDelete({ id: 'inbox', confirm: true }))).toContain('built-in')
      expect(yield* message(trees.folderUpdate({ id: 'inbox', title: 'Mail' }))).toContain('built-in')
      expect(yield* message(trees.folderMove({ id: 'missing' }))).toContain('sidebar_tree_get')
      expect(yield* message(trees.panelAdd({ viewId: 'x', folderId: 'missing' }))).toContain('No sidebar folder')
      expect(yield* message(trees.panelMove({ viewId: 'not-filed-view', folderId: 'work' }))).toContain('sidebar_panel_add')
      expect(yield* message(trees.folderRestore({ id: 'never' }))).toContain('30 days')
      expect((yield* Effect.flip(trees.folderRestore({ id: 'never' })))._tag).toBe('SidebarTreeRefused')
    }).pipe(Effect.provide(treesLayer())),
  )

  it.effect('tombstones expire after 30 days', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      yield* trees.folderCreate({ title: 'Old' })
      yield* trees.folderDelete({ id: 'old', confirm: true })
      yield* TestClock.adjust(TOMBSTONE_RETENTION_MS + 1)
      expect((yield* trees.get).tree.tombstones).toEqual([])
      expect((yield* Effect.flip(trees.folderRestore({ id: 'old' })))._tag).toBe('SidebarTreeRefused')
    }).pipe(Effect.provide(treesLayer())),
  )

  // The conflict retry waits on the real clock between attempts.
  it.live('recomputes a verb on a fresh read after another writer moved the revision, and reports a failed write', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      const faults = yield* Faults
      yield* Ref.set(faults.conflictNext, 2)
      expect((yield* trees.folderCreate({ title: 'Racy' })).folderId).toBe('racy')
      expect(folderIds(yield* trees.get).filter(id => id === 'racy')).toHaveLength(1)
      yield* Ref.set(faults.failNext, true)
      expect((yield* Effect.flip(trees.folderCreate({ title: 'Lost' })))._tag).toBe('SidebarSettingsWriteFailed')
      const stored = yield* ThreadSidebarSettings
      // Other sidebar settings are untouched by tree writes.
      expect((yield* stored.get).headerMode).toBe(defaults().headerMode)
    }).pipe(Effect.provide(treesLayer())),
  )

  it.effect('lists the panels browsers reported, says when none did, and keeps one report per browser', () =>
    Effect.gen(function* () {
      const trees = yield* SidebarTrees
      const empty = yield* trees.panelsAvailable
      expect(empty).toMatchObject({ panels: [], reportedAt: null, browsers: 0 })
      expect(empty.note).toContain('Open the DSH page')
      yield* trees.reportPanels({ browserId: 'browser-aaaa', panels: [{ id: 'traces', title: 'Traces', kind: 'page' }] })
      yield* trees.reportPanels({ browserId: 'browser-aaaa', panels: [{ id: 'usage', title: 'Usage', kind: 'page' }] })
      yield* trees.reportPanels({ browserId: 'browser-bbbb', panels: [{ id: 'dshfiles-changes', title: 'Changes', kind: 'facet' }] })
      const listed = yield* trees.panelsAvailable
      expect(listed.browsers).toBe(2)
      expect(listed.panels.map(panel => panel.id)).toEqual(['dshfiles-changes', 'usage'])
      // A reported page is mapped: removing it lists it as removed even though it was never filed.
      expect((yield* trees.panelRemove({ viewId: 'usage' })).tree.removed).toEqual(['usage'])
    }).pipe(Effect.provide(treesLayer())),
  )

  it('requires explicit confirmation for destructive verbs and a change for an update', () => {
    expect(decodeStrict(sidebarFolderDeleteSchema, { id: 'review' })).toBe(false)
    expect(decodeStrict(sidebarFolderDeleteSchema, { id: 'review', confirm: false })).toBe(false)
    expect(decodeStrict(sidebarFolderDeleteSchema, { id: 'review', confirm: true })).toBe(true)
    expect(decodeStrict(sidebarTreeResetSchema, {})).toBe(false)
    expect(decodeStrict(sidebarTreeResetSchema, { confirm: true })).toBe(true)
    expect(decodeStrict(sidebarFolderUpdateSchema, { id: 'review' })).toBe(false)
    expect(decodeStrict(sidebarFolderUpdateSchema, { id: 'review', hidden: true })).toBe(true)
  })
})
