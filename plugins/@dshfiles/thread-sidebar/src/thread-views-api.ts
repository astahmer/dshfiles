import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_OPTIONS } from './thread-view.js'
import { threadViewSettingsSchema } from './thread-view-preferences.js'
import { SchemaHelpers } from './schema-helpers.js'

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
const threadViewCreateFields = { id: viewIdSchema, ...viewFields }
const threadViewUpdateFields = {
  id: viewIdSchema,
  name: Schema.optional(viewFields.name),
  enabled: Schema.optional(viewFields.enabled),
  groupBy: Schema.optional(viewFields.groupBy),
  statusFilters: Schema.optional(viewFields.statusFilters),
  sourceFilter: Schema.optional(viewFields.sourceFilter),
}

export const threadViewCreateSchema = SchemaHelpers.strictStruct(Schema.Struct(threadViewCreateFields))
export const threadViewUpdateSchema = SchemaHelpers.strictStruct(Schema.Struct(threadViewUpdateFields)).check(
  Schema.makeFilter(input => (Object.keys(input).length > 1 ? undefined : 'Provide a view change.')),
)
export const threadViewIdSchema = SchemaHelpers.strictStruct(Schema.Struct({ id: viewIdSchema }))
export const threadViewDeleteSchema = SchemaHelpers.strictStruct(Schema.Struct({ id: viewIdSchema, confirm: Schema.Literal(true) }))
export const threadViewMoveSchema = SchemaHelpers.strictStruct(Schema.Struct({ id: viewIdSchema, direction: Schema.Literals(['earlier', 'later']) }))
export const threadViewSelectSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    id: Schema.optional(viewIdSchema),
    showGroupControl: Schema.optional(Schema.Boolean),
    showFilterControl: Schema.optional(Schema.Boolean),
  }),
).check(Schema.makeFilter(input => (Object.keys(input).length > 0 ? undefined : 'Provide a view or visibility change.')))

const output = Schema.Struct({
  settings: threadViewSettingsSchema,
  revision: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
})
const viewOutput = Schema.Struct({
  view: SchemaHelpers.strictStruct(Schema.Struct(threadViewCreateFields)),
  revision: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
})
const render = (result: typeof output.Type) => `${result.settings.views.length} saved thread views; selected ${result.settings.activeViewId}.`

export const threadViewsApi = defineApi({
  id: 'thread-sidebar-views',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({})),
      output,
      description: 'Read saved thread sidebar views, their order, active view and control visibility. Read-only.',
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
      description: 'Create a saved thread sidebar view. Call only when the user asked to create that view.',
      tool: { name: 'thread_view_create', render },
    }),
    update: method({
      input: threadViewUpdateSchema,
      output,
      description: 'Change a saved thread sidebar view name, enabled state, grouping or filters. Call only when the user asked for that change.',
      tool: { name: 'thread_view_update', render },
    }),
    delete: method({
      input: threadViewDeleteSchema,
      output,
      description: 'Delete a saved thread sidebar view. Requires explicit confirm: true. Call only when the user asked to delete that view.',
      tool: { name: 'thread_view_delete', render },
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
        'Select an enabled saved thread sidebar view or change grouping/filter control visibility. Call only when the user asked for that selection or visibility change.',
      tool: { name: 'thread_view_select', render },
    }),
  },
})
