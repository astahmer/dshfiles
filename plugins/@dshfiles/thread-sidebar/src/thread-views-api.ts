import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_OPTIONS } from './thread-view.js'
import { projectFilterSchema, threadViewSettingsSchema } from './thread-view-preferences.js'

const viewIdSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u))
const statusFiltersSchema = Schema.Array(Schema.Literals(THREAD_STATUS_FILTER_OPTIONS.filter(value => value !== 'all'))).check(
  Schema.makeFilter(filters => (new Set(filters).size === filters.length ? undefined : 'Filters must be unique.')),
)
const viewFields = {
  name: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(32))),
  enabled: Schema.Boolean,
  groupBy: Schema.Literals(THREAD_GROUP_BY_OPTIONS),
  statusFilters: statusFiltersSchema,
  sourceFilter: Schema.Literals(THREAD_SOURCE_FILTER_OPTIONS),
}
const viewSchema = Schema.Struct({ id: viewIdSchema, ...viewFields, projectFilter: Schema.optional(projectFilterSchema) })
const positionSchema = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
/** Omitted filters are the list's current ones, so `{ id, name }` saves the current filters as a preset. */
const threadViewCreateFields = {
  id: viewIdSchema,
  name: viewFields.name,
  enabled: Schema.optional(viewFields.enabled),
  groupBy: Schema.optional(viewFields.groupBy),
  statusFilters: Schema.optional(viewFields.statusFilters),
  sourceFilter: Schema.optional(viewFields.sourceFilter),
  projectFilter: Schema.optional(projectFilterSchema),
  position: Schema.optional(positionSchema),
  select: Schema.optional(Schema.Boolean),
}
const threadViewUpdateFields = {
  id: viewIdSchema,
  name: Schema.optional(viewFields.name),
  enabled: Schema.optional(viewFields.enabled),
  groupBy: Schema.optional(viewFields.groupBy),
  statusFilters: Schema.optional(viewFields.statusFilters),
  sourceFilter: Schema.optional(viewFields.sourceFilter),
  projectFilter: Schema.optional(projectFilterSchema),
  fromCurrent: Schema.optional(Schema.Literal(true)),
}

export const threadViewCreateSchema = Schema.Struct(threadViewCreateFields)
export const threadViewUpdateSchema = Schema.Struct(threadViewUpdateFields).check(
  Schema.makeFilter(input => (Object.keys(input).length > 1 ? undefined : 'Provide a view change.')),
)
export const threadViewIdSchema = Schema.Struct({ id: viewIdSchema })
export const threadViewDeleteSchema = Schema.Struct({ id: viewIdSchema, confirm: Schema.Literal(true) })
export const threadViewMoveSchema = Schema.Struct({ id: viewIdSchema, direction: Schema.Literals(['earlier', 'later']) })
export const threadViewSelectSchema = Schema.Struct({
  id: Schema.optional(viewIdSchema),
  showGroupControl: Schema.optional(Schema.Boolean),
  showFilterControl: Schema.optional(Schema.Boolean),
  showPresets: Schema.optional(Schema.Boolean),
  showPresetChips: Schema.optional(Schema.Boolean),
}).check(Schema.makeFilter(input => (Object.keys(input).length > 0 ? undefined : 'Provide a view or visibility change.')))

const revisionSchema = Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const output = Schema.Struct({
  settings: threadViewSettingsSchema,
  revision: revisionSchema,
  /** The thread list's current project scope (the project picker): an id, '' for Unassigned, null for All projects. */
  projectFilter: Schema.optional(projectFilterSchema),
  /** Whether the list's filters differ from the active preset as saved (the Filter button reads "(edited)"). */
  edited: Schema.optional(Schema.Boolean),
})
const deleteOutput = Schema.Struct({
  ...output.fields,
  /** The removed preset and where it was: thread_view_create with these fields and `position` restores it. */
  deleted: Schema.Struct({ view: viewSchema, position: positionSchema }),
})
const viewOutput = Schema.Struct({ view: viewSchema, revision: revisionSchema })
const render = (result: typeof output.Type) =>
  `${result.settings.views.length} saved thread views; selected ${result.settings.activeViewId}${result.edited === true ? ' (edited)' : ''}.`

export const threadViewsApi = defineApi({
  id: 'thread-sidebar-views',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: Schema.Struct({}),
      output,
      description:
        'Read the thread list filter presets (saved views): their filters, order, the active preset, whether the list was edited since it was applied (`edited`, unsaved filters in `settings.draft`), the current project scope and control visibility. Read-only.',
      tool: { name: 'thread_views_list', readOnly: true, render: result => JSON.stringify(result) },
    }),
    get: method({
      input: threadViewIdSchema,
      output: viewOutput,
      description: 'Read one saved thread sidebar view by id. Missing views fail explicitly. Read-only.',
      tool: { name: 'thread_view_get', readOnly: true, render: result => JSON.stringify(result) },
    }),
    create: method({
      input: threadViewCreateSchema,
      output,
      description:
        "Create a thread list filter preset. Omitted groupBy/statusFilters/sourceFilter are the list's current filters, so { id, name, projectFilter } saves the current filters as a preset; projectFilter null = All projects, omitted = the preset leaves the project picker alone. `select: true` applies it; `position` inserts it there (restores a deleted preset in place). Call only when the user asked to create that preset.",
      tool: { name: 'thread_view_create', render },
    }),
    update: method({
      input: threadViewUpdateSchema,
      output,
      description:
        "Rename a thread list filter preset, hide or show it (enabled), or change its grouping, filters or project scope. `fromCurrent: true` writes the list's current filters into it (Save changes / Update with current filters). Call only when the user asked for that change.",
      tool: { name: 'thread_view_update', render },
    }),
    delete: method({
      input: threadViewDeleteSchema,
      output: deleteOutput,
      description:
        'Delete a thread list filter preset. Requires explicit confirm: true. The result names the removed preset and its position; thread_view_create with them restores it. Call only when the user asked to delete that preset.',
      tool: {
        name: 'thread_view_delete',
        render: result => `${render(result)} Deleted ${result.deleted.view.id} from position ${result.deleted.position}; thread_view_create restores it.`,
      },
    }),
    move: method({
      input: threadViewMoveSchema,
      output,
      description: 'Move a saved thread sidebar view one position earlier or later. Call only when the user asked to reorder that view.',
      tool: { name: 'thread_view_move', render },
    }),
    select: method({
      input: threadViewSelectSchema,
      output,
      description:
        'Apply an enabled thread list filter preset (drops unsaved filter changes; a preset with a project scope sets the project picker), or change the visibility of the Group/Filter controls, the Presets section (showPresets) and the preset chips row (showPresetChips). Call only when the user asked for that selection or visibility change.',
      tool: { name: 'thread_view_select', render },
    }),
  },
})
