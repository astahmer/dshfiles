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
type ViewRead = { readonly settings: ThreadViewSettings; readonly revision: number }
type ViewFailure = ThreadViewNotFound | ThreadViewExists | ThreadViewRefused | ThreadViewsInvalid
type ViewWriteFailure = ViewFailure | ThreadViewsConflict | SidebarSettingsWriteFailed

const decodeSettings = Schema.decodeUnknownEffect(threadViewSettingsSchema)

const invalid = (source: ThreadViewsInvalid['source']) => (cause: Schema.SchemaError) =>
  new ThreadViewsInvalid({ source, issue: cause.message.slice(0, MAX_ISSUE), cause })

const viewOf = (settings: ThreadViewSettings, id: string): Effect.Effect<ThreadView, ThreadViewNotFound> => {
  const view = settings.views.find(candidate => candidate.id === id)
  return view === undefined ? Effect.fail(new ThreadViewNotFound({ id })) : Effect.succeed(view)
}

const enabledCount = (settings: ThreadViewSettings): number => settings.views.filter(candidate => candidate.enabled).length

/**
 * The saved thread views in the sidebar settings. Changes are serialized and each one writes against the revision it
 * read, so a concurrent edit from a browser fails as a conflict instead of being overwritten.
 */
export class ThreadViews extends Context.Service<
  ThreadViews,
  {
    readonly list: Effect.Effect<ViewRead, ThreadViewsInvalid>
    readonly get: (input: { readonly id: string }) => Effect.Effect<{ readonly view: ThreadView; readonly revision: number }, ViewFailure>
    readonly create: (input: typeof threadViewCreateSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
    readonly update: (input: typeof threadViewUpdateSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
    readonly delete: (input: typeof threadViewDeleteSchema.Type) => Effect.Effect<ViewRead, ViewWriteFailure>
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
        return { settings: views, revision: snapshot.revision }
      })

      const change = (operation: (settings: ThreadViewSettings) => Effect.Effect<ThreadViewSettings, ViewFailure>) =>
        exclusive(
          Effect.gen(function* () {
            const current = yield* list
            const next = yield* operation(current.settings).pipe(Effect.flatMap(changed => decodeSettings(changed).pipe(Effect.mapError(invalid('change')))))
            yield* settings.update({ threadViews: next }, current.revision).pipe(
              Effect.catchTags({
                SettingsConflict: cause => Effect.fail(new ThreadViewsConflict({ expected: cause.expected, actual: cause.actual, cause })),
                SettingsWriteFailed: cause => Effect.fail(new SidebarSettingsWriteFailed({ cause })),
              }),
            )
            const written = { settings: next, revision: current.revision + 1 }
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
        create: Effect.fn('thread views create')(function* (view) {
          return yield* change(current =>
            current.views.some(candidate => candidate.id === view.id)
              ? Effect.fail(new ThreadViewExists({ id: view.id }))
              : Effect.succeed(ThreadViewPreferencesModel.saveThreadView(current, view)),
          )
        }),
        update: Effect.fn('thread views update')(function* (patch) {
          return yield* change(current =>
            Effect.gen(function* () {
              const view = yield* viewOf(current, patch.id)
              if (patch.enabled === false && view.enabled && enabledCount(current) === 1) return yield* new ThreadViewRefused({ reason: 'last-enabled' })
              const enabled = patch.enabled === undefined ? current : ThreadViewPreferencesModel.setThreadViewEnabled(current, view.id, patch.enabled)
              const currentView = yield* viewOf(enabled, view.id)
              return ThreadViewPreferencesModel.saveThreadView(enabled, {
                id: view.id,
                name: patch.name === undefined ? currentView.name : patch.name,
                enabled: currentView.enabled,
                groupBy: patch.groupBy ?? currentView.groupBy,
                statusFilters: patch.statusFilters ?? currentView.statusFilters,
                sourceFilter: patch.sourceFilter ?? currentView.sourceFilter,
              })
            }),
          )
        }),
        delete: Effect.fn('thread views delete')(function* (input) {
          return yield* change(current =>
            Effect.gen(function* () {
              const view = yield* viewOf(current, input.id)
              if (current.views.length === 1 || (view.enabled && enabledCount(current) === 1)) return yield* new ThreadViewRefused({ reason: 'last-enabled' })
              return ThreadViewPreferencesModel.removeThreadView(current, view.id)
            }),
          )
        }),
        move: Effect.fn('thread views move')(function* (input) {
          return yield* change(current =>
            viewOf(current, input.id).pipe(Effect.as(ThreadViewPreferencesModel.moveThreadView(current, input.id, input.direction === 'earlier' ? -1 : 1))),
          )
        }),
        select: Effect.fn('thread views select')(function* (input) {
          return yield* change(current =>
            Effect.gen(function* () {
              if (input.id !== undefined && !(yield* viewOf(current, input.id)).enabled) return yield* new ThreadViewRefused({ reason: 'disabled' })
              const selected = input.id === undefined ? current : ThreadViewPreferencesModel.selectThreadView(current, input.id)
              return {
                ...selected,
                showGroupControl: input.showGroupControl ?? selected.showGroupControl,
                showFilterControl: input.showFilterControl ?? selected.showFilterControl,
              }
            }),
          )
        }),
      })
    }),
  )
}
