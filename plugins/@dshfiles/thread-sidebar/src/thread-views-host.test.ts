import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { threadSidebarSettings } from './settings.js'
import { ThreadSidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'
import { threadViewCreateSchema, threadViewDeleteSchema, threadViewUpdateSchema } from './thread-views-api.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, MAX_THREAD_VIEWS } from './thread-view-preferences.js'
import { ThreadViews } from './thread-views-host.js'

const defaults = (): SidebarSettingsValue => threadSidebarSettings.schema({})

/** The next write meets a concurrent edit from another writer, or is rejected by DSH. */
class Faults extends Context.Service<Faults, { readonly conflictNext: Ref.Ref<boolean>; readonly failNext: Ref.Ref<boolean> }>()('test/Faults') {
  static readonly layer = Layer.effect(Faults, Effect.all({ conflictNext: Ref.make(false), failNext: Ref.make(false) }))
}

/** Real in-memory settings with revision checks, plus the two failures a DSH settings write can meet. */
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
            if (yield* Ref.getAndSet(faults.conflictNext, false)) yield* real.update({})
            if (yield* Ref.getAndSet(faults.failNext, false)) {
              return yield* new Settings.SettingsWriteFailed({ namespace: 'thread-sidebar', operation: 'update', cause: new Error('Persistence failed') })
            }
            return yield* real.update(patch, expectedRevision)
          }),
      })
    }),
  ).pipe(Layer.provide(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', initial)))

const viewsLayer = (initial = defaults()) => ThreadViews.layer.pipe(Layer.provideMerge(settingsWithFaults(initial)), Layer.provideMerge(Faults.layer))

const custom = (id = 'custom') => ({ id, name: id, enabled: true, groupBy: 'status' as const, statusFilters: [], sourceFilter: 'all' as const })

const failureMessage = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) => Effect.map(Effect.flip(effect), error => error.message)

const decodes = (schema: Schema.Codec<unknown, unknown>, input: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(schema)(input, { onExcessProperty: 'error' }))

describe('Host saved thread views', () => {
  it.effect('uses the settings provider for list, create, get, update, move, select, visibility and deletion', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      expect((yield* views.list).settings).toEqual(DEFAULT_THREAD_VIEW_SETTINGS)
      yield* views.create(custom())
      expect((yield* views.get({ id: 'custom' })).view.name).toBe('custom')
      yield* views.update({ id: 'custom', name: 'Renamed', groupBy: 'project', statusFilters: ['working'], sourceFilter: 'main' })
      expect((yield* views.get({ id: 'custom' })).view).toMatchObject({ name: 'Renamed', groupBy: 'project', statusFilters: ['working'], sourceFilter: 'main' })
      yield* views.move({ id: 'custom', direction: 'earlier' })
      expect((yield* views.list).settings.views.at(-2)?.id).toBe('custom')
      yield* views.select({ id: 'custom', showFilterControl: false, showGroupControl: false })
      expect((yield* views.list).settings).toMatchObject({ activeViewId: 'custom', showFilterControl: false, showGroupControl: false })
      yield* views.update({ id: 'custom', enabled: false })
      expect((yield* views.list).settings.activeViewId).not.toBe('custom')
      yield* views.delete({ id: 'custom', confirm: true })
      expect((yield* Effect.flip(views.get({ id: 'custom' })))._tag).toBe('ThreadViewNotFound')
      const stored = yield* ThreadSidebarSettings
      expect((yield* stored.get).headerMode).toBe(defaults().headerMode)
    }).pipe(Effect.provide(viewsLayer())),
  )

  it.effect('fails missing targets explicitly for every targeted operation', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      expect(yield* failureMessage(views.get({ id: 'missing' }))).toContain('does not exist')
      expect(yield* failureMessage(views.update({ id: 'missing', enabled: true }))).toContain('does not exist')
      expect(yield* failureMessage(views.delete({ id: 'missing', confirm: true }))).toContain('does not exist')
      expect(yield* failureMessage(views.move({ id: 'missing', direction: 'later' }))).toContain('does not exist')
      expect(yield* failureMessage(views.select({ id: 'missing' }))).toContain('does not exist')
    }).pipe(Effect.provide(viewsLayer())),
  )

  it.effect('rejects duplicates, invalid names, last enabled changes and view limits', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      yield* views.create(custom())
      expect(yield* failureMessage(views.create(custom()))).toContain('already exists')
      expect(yield* failureMessage(views.create({ ...custom('other'), name: 'CUSTOM' }))).toContain('unique')
      expect(yield* failureMessage(views.create({ ...custom('unnamed'), name: null }))).toContain('need a name')
      for (const view of (yield* views.list).settings.views.filter(view => view.id !== 'custom')) yield* views.update({ id: view.id, enabled: false })
      expect(yield* failureMessage(views.update({ id: 'custom', enabled: false }))).toContain('remain enabled')
      expect(yield* failureMessage(views.delete({ id: 'custom', confirm: true }))).toContain('remain enabled')
      expect(yield* failureMessage(views.select({ id: DEFAULT_THREAD_VIEW_SETTINGS.views[0]?.id ?? '' }))).toContain('disabled')
      while ((yield* views.list).settings.views.length < MAX_THREAD_VIEWS) yield* views.create(custom(`view-${(yield* views.list).settings.views.length}`))
      expect((yield* Effect.flip(views.create(custom('overflow'))))._tag).toBe('ThreadViewsInvalid')
    }).pipe(Effect.provide(viewsLayer())),
  )

  it.effect('keeps boundary moves stable and rejects duplicate renames without writing', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      const first = (yield* views.list).settings.views[0]
      if (first === undefined) return yield* Effect.die('Expected a default view')
      yield* views.move({ id: first.id, direction: 'earlier' })
      expect((yield* views.list).settings.views[0]?.id).toBe(first.id)
      yield* views.create(custom('one'))
      yield* views.create({ ...custom('two'), enabled: false })
      const revision = (yield* views.list).revision
      expect(yield* failureMessage(views.update({ id: 'two', name: 'ONE' }))).toContain('unique')
      expect((yield* views.list).revision).toBe(revision)
      expect(yield* failureMessage(views.select({ id: 'two' }))).toContain('disabled')
      yield* views.delete({ id: 'two', confirm: true })
      expect((yield* views.list).settings.activeViewId).toBe(DEFAULT_THREAD_VIEW_SETTINGS.activeViewId)
      yield* views.select({ showFilterControl: false })
      expect((yield* views.list).settings.showFilterControl).toBe(false)
      expect((yield* views.list).settings.activeViewId).toBe(DEFAULT_THREAD_VIEW_SETTINGS.activeViewId)
    }).pipe(Effect.provide(viewsLayer())),
  )

  it('rejects invalid commands rather than applying migration coercion', () => {
    expect(decodes(threadViewCreateSchema, { ...custom(), id: '../bad' })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), statusFilters: ['bogus'] })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), statusFilters: ['all'] })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), statusFilters: ['working', 'working'] })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), statusFilters: ['not-working'] })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), name: ' ' })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), name: 'a'.repeat(33) })).toBe(false)
    expect(decodes(threadViewCreateSchema, { ...custom(), id: 'a'.repeat(65) })).toBe(false)
    expect(decodes(threadViewUpdateSchema, { id: 'custom' })).toBe(false)
    expect(decodes(threadViewUpdateSchema, { id: 'custom', unknown: true })).toBe(false)
    expect(decodes(threadViewDeleteSchema, { id: 'custom' })).toBe(false)
    expect(decodes(threadViewDeleteSchema, { id: 'custom', confirm: false })).toBe(false)
  })

  it.effect('serializes its updates and refuses concurrent external edits without losing data', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      const faults = yield* Faults
      yield* Effect.all([views.create(custom('one')), views.create(custom('two'))], { concurrency: 'unbounded' })
      expect((yield* views.get({ id: 'one' })).view.id).toBe('one')
      expect((yield* views.get({ id: 'two' })).view.id).toBe('two')
      yield* Ref.set(faults.conflictNext, true)
      const conflict = yield* Effect.flip(views.update({ id: 'one', name: 'changed' }))
      expect(conflict._tag).toBe('ThreadViewsConflict')
      expect(conflict.message).toContain('SETTINGS_CONFLICT')
      expect((yield* views.get({ id: 'one' })).view.name).toBe('one')
      yield* Ref.set(faults.failNext, true)
      expect((yield* Effect.flip(views.delete({ id: 'one', confirm: true })))._tag).toBe('SidebarSettingsWriteFailed')
      expect((yield* views.get({ id: 'one' })).view.id).toBe('one')
      yield* views.update({ id: 'one', name: 'recovered' })
      expect((yield* views.get({ id: 'one' })).view.name).toBe('recovered')
    }).pipe(Effect.provide(viewsLayer())),
  )

  it.effect('refuses an invalid persisted document', () =>
    Effect.gen(function* () {
      const views = yield* ThreadViews
      expect((yield* Effect.flip(views.list))._tag).toBe('ThreadViewsInvalid')
    }).pipe(Effect.provide(viewsLayer({ ...defaults(), threadViews: { ...DEFAULT_THREAD_VIEW_SETTINGS, views: [] } }))),
  )
})
