import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import { SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { ThreadSidebarSettings } from './sidebar-settings.js'
import type {
  threadViewCreateSchema,
  threadViewDeleteSchema,
  threadViewMoveSchema,
  threadViewSelectSchema,
  threadViewUpdateSchema,
} from './thread-views-api.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, ThreadViewPreferencesModel, threadViewSettingsSchema, type ThreadViewSettings } from './thread-view-preferences.js'

const MAX_ISSUE = 500

/** No saved view has this id. */
export class ThreadViewNotFound extends Schema.TaggedError<ThreadViewNotFound>()(
  'ThreadViewNotFound',
  { id: Schema.String.check(Schema.isMaxLength(64)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-view-not-found' },
) {
  override get message(): string {
    return `Saved thread view ${JSON.stringify(this.id)} does not exist. List the views and pick an existing id.`
  }
}

/** A saved view with this id already exists. */
export class ThreadViewExists extends Schema.TaggedError<ThreadViewExists>()(
  'ThreadViewExists',
  { id: Schema.String.check(Schema.isMaxLength(64)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-view-exists' },
) {
  override get message(): string {
    return `Saved thread view ${JSON.stringify(this.id)} already exists. Choose another id or update that view.`
  }
}

/** The change would leave no enabled view, or selects a disabled one. */
export class ThreadViewRefused extends Schema.TaggedError<ThreadViewRefused>()(
  'ThreadViewRefused',
  { reason: Schema.Literals(['last-enabled', 'disabled']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-view-refused' },
) {
  override get message(): string {
    return this.reason === 'last-enabled'
      ? 'At least one view must remain enabled. Enable another view first.'
      : 'Cannot select a disabled thread view. Enable it first.'
  }
}

/** The views after the change, or the stored ones, break a view rule (unique names, a name, the view limit). */
export class ThreadViewsInvalid extends Schema.TaggedError<ThreadViewsInvalid>()(
  'ThreadViewsInvalid',
  { source: Schema.Literals(['change', 'stored']), issue: Schema.String.check(Schema.isMaxLength(MAX_ISSUE)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-views-invalid' },
) {
  override get message(): string {
    return this.source === 'change' ? `The thread view change is not valid: ${this.issue}` : `The saved thread views are not valid: ${this.issue}`
  }
}

/** Another writer changed the sidebar settings since they were read; nothing was written. */
export class ThreadViewsConflict extends Schema.TaggedError<ThreadViewsConflict>()(
  'ThreadViewsConflict',
  { expected: Schema.Number, actual: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-conflict' },
) {
  override get message(): string {
    return `The thread-sidebar settings changed while this edit was prepared (SETTINGS_CONFLICT: revision ${this.actual}, expected ${this.expected}). List the views again and retry.`
  }
}

type ThreadView = ThreadViewSettings['views'][number]
type ViewRead = {
  readonly settings: ThreadViewSettings
  readonly revision: number
  /** The list's project scope (the project picker), stored beside the views in the same namespace. */
  readonly projectFilter: string | null
  readonly edited: boolean
}
type ViewFailure = ThreadViewNotFound | ThreadViewExists | ThreadViewRefused | ThreadViewsInvalid
type ViewWriteFailure = ViewFailure | ThreadViewsConflict | SidebarSettingsWriteFailed
/** What a change writes: the views, and the project scope when applying a preset that names one. */
type ViewChange = { readonly settings: ThreadViewSettings; readonly workspaceFilter?: string | null }

const decodeSettings = Schema.decodeUnknownEffect(threadViewSettingsSchema)

const invalid = (source: ThreadViewsInvalid['source']) => (cause: Schema.SchemaError) =>
  new ThreadViewsInvalid({ source, issue: cause.message.slice(0, MAX_ISSUE), cause })

const viewOf = (settings: ThreadViewSettings, id: string): Effect.Effect<ThreadView, ThreadViewNotFound> => {
  const view = settings.views.find(candidate => candidate.id === id)
  return view === undefined ? Effect.fail(new ThreadViewNotFound({ id })) : Effect.succeed(view)
}

const enabledCount = (settings: ThreadViewSettings): number => settings.views.filter(candidate => candidate.enabled).length

const readOf = (settings: ThreadViewSettings, revision: number, projectFilter: string | null): ViewRead => ({
  settings,
  revision,
  projectFilter,
  edited: ThreadViewPreferencesModel.isThreadViewEdited(settings, projectFilter),
})

/**
 * The saved thread views (filter presets) in the sidebar settings. Changes are serialized and each one writes against
 * the revision it read, so a concurrent edit from a browser fails as a conflict instead of being overwritten.
 */
export class ThreadViews extends Context.Service<
  ThreadViews,
  {
    readonly list: Effect.Effect<ViewRead, ThreadViewsInvalid>
    readonly get: (input: { readonly id: string }) => Effect.Effect<{ readonly view: ThreadView; readonly revision: number }, ViewFailure>
    readonly create: (input: typeof threadViewCreateSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
    readonly update: (input: typeof threadViewUpdateSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
    readonly delete: (
      input: typeof threadViewDeleteSchema.Type,
    ) => Effect.Effect<ViewRead & { readonly deleted: { readonly view: ThreadView; readonly position: number } }, ViewWriteFailure>
    readonly move: (input: typeof threadViewMoveSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
    readonly select: (input: typeof threadViewSelectSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
  }
>()('@dshfiles/thread-sidebar/ThreadViews') {
  static readonly layer = Layer.effect(
    ThreadViews,
    Effect.gen(function* () {
      const settings = yield* ThreadSidebarSettings
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)
      // The settings snapshot refreshes when DSH announces the commit; until then this process's own last write is newer.
      const ownWrite = yield* Ref.make(Option.none<ViewRead>())

      const list = Effect.gen(function* () {
        const snapshot = yield* settings.snapshot
        const own = yield* Ref.get(ownWrite)
        if (Option.isSome(own) && own.value.revision > snapshot.revision) return own.value
        const views = yield* decodeSettings(snapshot.value.threadViews ?? DEFAULT_THREAD_VIEW_SETTINGS).pipe(Effect.mapError(invalid('stored')))
        return readOf(views, snapshot.revision, snapshot.value.workspaceFilter ?? null)
      })

      const change = (operation: (current: ViewRead) => Effect.Effect<ThreadViewSettings | ViewChange, ViewFailure>) =>
        exclusive(
          Effect.gen(function* () {
            const current = yield* list
            const result = yield* operation(current)
            const changed: ViewChange = 'settings' in result ? result : { settings: result }
            const next = yield* decodeSettings(changed.settings).pipe(Effect.mapError(invalid('change')))
            const workspaceFilter = changed.workspaceFilter === undefined ? current.projectFilter : changed.workspaceFilter
            const patch = changed.workspaceFilter === undefined ? { threadViews: next } : { threadViews: next, workspaceFilter }
            yield* settings.update(patch, current.revision).pipe(
              Effect.catchTags({
                SettingsConflict: cause => Effect.fail(new ThreadViewsConflict({ expected: cause.expected, actual: cause.actual, cause })),
                SettingsWriteFailed: cause => Effect.fail(new SidebarSettingsWriteFailed({ cause })),
              }),
            )
            const written = readOf(next, current.revision + 1, workspaceFilter)
            yield* Ref.set(ownWrite, Option.some(written))
            return written
          }),
        )

      return ThreadViews.of({
        list: list.pipe(Effect.withSpan('thread views list')),
        get: Effect.fn('thread views get')(function* (input) {
          const current = yield* list
          return { view: yield* viewOf(current.settings, input.id), revision: current.revision }
        }),
        create: Effect.fn('thread views create')(function* (input) {
          return yield* change(({ settings: current }) => {
            if (current.views.some(candidate => candidate.id === input.id)) return Effect.fail(new ThreadViewExists({ id: input.id }))
            const filters = ThreadViewPreferencesModel.currentThreadViewFilters(current)
            const view: ThreadView = {
              id: input.id,
              name: input.name,
              enabled: input.enabled ?? true,
              groupBy: input.groupBy ?? filters.groupBy,
              statusFilters: input.statusFilters ?? filters.statusFilters,
              sourceFilter: input.sourceFilter ?? filters.sourceFilter,
              ...(input.projectFilter === undefined ? {} : { projectFilter: input.projectFilter }),
            }
            const inserted = ThreadViewPreferencesModel.insertThreadView(current, view, input.position)
            return Effect.succeed(input.select === true && view.enabled ? ThreadViewPreferencesModel.applyThreadViewPreset(inserted, view.id) : inserted)
          })
        }),
        update: Effect.fn('thread views update')(function* (patch) {
          return yield* change(({ settings: current, projectFilter: workspaceFilter }) =>
            Effect.gen(function* () {
              const view = yield* viewOf(current, patch.id)
              if (patch.enabled === false && view.enabled && enabledCount(current) === 1) return yield* new ThreadViewRefused({ reason: 'last-enabled' })
              const fromCurrent =
                patch.fromCurrent === true ? ThreadViewPreferencesModel.saveCurrentFiltersToPreset(current, view.id, workspaceFilter) : current
              const enabled = patch.enabled === undefined ? fromCurrent : ThreadViewPreferencesModel.setThreadViewEnabled(fromCurrent, view.id, patch.enabled)
              const currentView = yield* viewOf(enabled, view.id)
              const projectFilter = patch.projectFilter === undefined ? currentView.projectFilter : patch.projectFilter
              const { projectFilter: _previous, ...rest } = currentView
              return ThreadViewPreferencesModel.saveThreadView(enabled, {
                ...rest,
                name: patch.name === undefined ? currentView.name : patch.name,
                groupBy: patch.groupBy ?? currentView.groupBy,
                statusFilters: patch.statusFilters ?? currentView.statusFilters,
                sourceFilter: patch.sourceFilter ?? currentView.sourceFilter,
                ...(projectFilter === undefined ? {} : { projectFilter }),
              })
            }),
          )
        }),
        delete: Effect.fn('thread views delete')(function* (input) {
          const removed: { deleted?: { readonly view: ThreadView; readonly position: number } } = {}
          const written = yield* change(({ settings: current }) =>
            Effect.gen(function* () {
              const view = yield* viewOf(current, input.id)
              if (current.views.length === 1 || (view.enabled && enabledCount(current) === 1)) return yield* new ThreadViewRefused({ reason: 'last-enabled' })
              removed.deleted = { view, position: current.views.findIndex(candidate => candidate.id === view.id) }
              return ThreadViewPreferencesModel.removeThreadView(current, view.id)
            }),
          )
          if (removed.deleted === undefined) return yield* new ThreadViewNotFound({ id: input.id })
          return { ...written, deleted: removed.deleted }
        }),
        move: Effect.fn('thread views move')(function* (input) {
          return yield* change(({ settings: current }) =>
            viewOf(current, input.id).pipe(Effect.as(ThreadViewPreferencesModel.moveThreadView(current, input.id, input.direction === 'earlier' ? -1 : 1))),
          )
        }),
        select: Effect.fn('thread views select')(function* (input) {
          return yield* change(({ settings: current }) =>
            Effect.gen(function* () {
              if (input.id !== undefined && !(yield* viewOf(current, input.id)).enabled) return yield* new ThreadViewRefused({ reason: 'disabled' })
              const applied: ViewChange = input.id === undefined ? { settings: current } : ThreadViewPreferencesModel.applyThreadViewPreset(current, input.id)
              const presets =
                input.showPresets === undefined ? applied.settings : ThreadViewPreferencesModel.setPresetsEnabled(applied.settings, input.showPresets)
              const visibility = {
                ...presets,
                showGroupControl: input.showGroupControl ?? applied.settings.showGroupControl,
                showFilterControl: input.showFilterControl ?? applied.settings.showFilterControl,
                showPresetChips: input.showPresetChips ?? applied.settings.showPresetChips,
              }
              return applied.workspaceFilter === undefined ? { settings: visibility } : { settings: visibility, workspaceFilter: applied.workspaceFilter }
            }),
          )
        }),
      })
    }),
  )
}
