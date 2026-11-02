import * as Schema from 'effect/Schema'
import {
  threadViewsApi,
  threadViewCreateSchema,
  threadViewUpdateSchema,
  threadViewIdSchema,
  threadViewDeleteSchema,
  threadViewMoveSchema,
  threadViewSelectSchema,
} from './thread-views-api.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, ThreadViewPreferencesModel, threadViewSettingsSchema, type ThreadViewSettings } from './thread-view-preferences.js'

export interface ThreadViewsSettingsPort {
  describe(): readonly { readonly ns: string; readonly value: unknown; readonly revision: number }[]
  update(namespace: string, patch: { readonly threadViews: ThreadViewSettings }, expectedRevision?: number): Promise<void>
}

const namespaceSchema = Schema.Struct({ threadViews: Schema.optional(Schema.Unknown) })

export class ThreadViewsController {
  readonly #settings: ThreadViewsSettingsPort
  #pending: Promise<unknown> = Promise.resolve()

  constructor(settings: ThreadViewsSettingsPort) {
    this.#settings = settings
  }

  list = () => {
    const descriptor = this.#settings.describe().find(entry => entry.ns === 'thread-sidebar')
    if (descriptor === undefined) throw new Error('The thread-sidebar settings namespace is unavailable on this Host.')
    const document = Schema.decodeUnknownSync(namespaceSchema)(descriptor.value)
    return { settings: Schema.decodeUnknownSync(threadViewSettingsSchema)(document.threadViews ?? DEFAULT_THREAD_VIEW_SETTINGS), revision: descriptor.revision }
  }

  get = (input: Schema.Schema.Type<typeof threadViewIdSchema>) => {
    const parsed = Schema.decodeUnknownSync(threadViewIdSchema)(input)
    const current = this.list()
    return { view: this.#view(current.settings, parsed.id), revision: current.revision }
  }

  #view = (settings: ThreadViewSettings, id: string) => {
    const view = settings.views.find(candidate => candidate.id === id)
    if (view === undefined) throw new Error(`Saved thread view ${JSON.stringify(id)} does not exist.`)
    return view
  }

  #change = (operation: (settings: ThreadViewSettings) => ThreadViewSettings) => {
    const changed = this.#pending.then(async () => {
      const current = this.list()
      const next = Schema.decodeUnknownSync(threadViewSettingsSchema)(operation(current.settings))
      await this.#settings.update('thread-sidebar', { threadViews: next }, current.revision)
      return this.list()
    })
    this.#pending = changed.catch(() => undefined)
    return changed
  }

  create = (input: Schema.Schema.Type<typeof threadViewCreateSchema>) => {
    const view = Schema.decodeUnknownSync(threadViewCreateSchema)(input)
    return this.#change(settings => {
      if (settings.views.some(candidate => candidate.id === view.id)) throw new Error(`Saved thread view ${JSON.stringify(view.id)} already exists.`)
      return ThreadViewPreferencesModel.saveThreadView(settings, view)
    })
  }

  update = (input: Schema.Schema.Type<typeof threadViewUpdateSchema>) => {
    const patch = Schema.decodeUnknownSync(threadViewUpdateSchema)(input)
    return this.#change(settings => {
      const view = this.#view(settings, patch.id)
      if (patch.enabled === false && view.enabled && settings.views.filter(candidate => candidate.enabled).length === 1) {
        throw new Error('At least one view must remain enabled.')
      }
      const enabled = patch.enabled === undefined ? settings : ThreadViewPreferencesModel.setThreadViewEnabled(settings, view.id, patch.enabled)
      const currentView = this.#view(enabled, view.id)
      return ThreadViewPreferencesModel.saveThreadView(enabled, {
        id: view.id,
        name: patch.name === undefined ? currentView.name : patch.name,
        enabled: currentView.enabled,
        groupBy: patch.groupBy ?? currentView.groupBy,
        statusFilters: patch.statusFilters ?? currentView.statusFilters,
        sourceFilter: patch.sourceFilter ?? currentView.sourceFilter,
      })
    })
  }

  delete = (input: Schema.Schema.Type<typeof threadViewDeleteSchema>) => {
    const parsed = Schema.decodeUnknownSync(threadViewDeleteSchema)(input)
    return this.#change(settings => {
      const view = this.#view(settings, parsed.id)
      if (settings.views.length === 1 || (view.enabled && settings.views.filter(candidate => candidate.enabled).length === 1)) {
        throw new Error('At least one view must remain enabled.')
      }
      return ThreadViewPreferencesModel.removeThreadView(settings, view.id)
    })
  }

  move = (input: Schema.Schema.Type<typeof threadViewMoveSchema>) => {
    const parsed = Schema.decodeUnknownSync(threadViewMoveSchema)(input)
    return this.#change(settings => {
      this.#view(settings, parsed.id)
      return ThreadViewPreferencesModel.moveThreadView(settings, parsed.id, parsed.direction === 'earlier' ? -1 : 1)
    })
  }

  select = (input: Schema.Schema.Type<typeof threadViewSelectSchema>) => {
    const parsed = Schema.decodeUnknownSync(threadViewSelectSchema)(input)
    return this.#change(settings => {
      if (parsed.id !== undefined && !this.#view(settings, parsed.id).enabled) throw new Error('Cannot select a disabled thread view.')
      const selected = parsed.id === undefined ? settings : ThreadViewPreferencesModel.selectThreadView(settings, parsed.id)
      return {
        ...selected,
        showGroupControl: parsed.showGroupControl ?? selected.showGroupControl,
        showFilterControl: parsed.showFilterControl ?? selected.showFilterControl,
      }
    })
  }
}

const controllers = new WeakMap<ThreadViewsSettingsPort, ThreadViewsController>()
const controller = (settings: ThreadViewsSettingsPort) => {
  let current = controllers.get(settings)
  if (current !== undefined) return current
  current = new ThreadViewsController(settings)
  controllers.set(settings, current)
  return current
}

export const threadViewsHost = threadViewsApi.host({
  list: ({ ctx }) => controller(ctx.settings).list(),
  get: ({ ctx, input }) => controller(ctx.settings).get(input),
  create: ({ ctx, input }) => controller(ctx.settings).create(input),
  update: ({ ctx, input }) => controller(ctx.settings).update(input),
  delete: ({ ctx, input }) => controller(ctx.settings).delete(input),
  move: ({ ctx, input }) => controller(ctx.settings).move(input),
  select: ({ ctx, input }) => controller(ctx.settings).select(input),
})
