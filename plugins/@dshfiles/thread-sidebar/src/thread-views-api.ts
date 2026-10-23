import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_OPTIONS } from './thread-view.js'
import { threadViewSettingsSchema } from './thread-view-preferences.js'

const viewIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)
const fields = {
  name: z.string().trim().min(1).max(32).nullable(),
  enabled: z.boolean(),
  groupBy: z.enum(THREAD_GROUP_BY_OPTIONS),
  statusFilters: z
    .array(z.enum(THREAD_STATUS_FILTER_OPTIONS.filter(value => value !== 'all')))
    .refine(filters => new Set(filters).size === filters.length, 'Filters must be unique.'),
  sourceFilter: z.enum(THREAD_SOURCE_FILTER_OPTIONS),
}
export const threadViewCreateSchema = z.object({ id: viewIdSchema, ...fields }).strict()
export const threadViewUpdateSchema = z
  .object({ id: viewIdSchema, ...z.object(fields).partial().shape })
  .strict()
  .refine(input => Object.keys(input).length > 1, 'Provide a view change.')
export const threadViewIdSchema = z.object({ id: viewIdSchema }).strict()
export const threadViewDeleteSchema = threadViewIdSchema.extend({ confirm: z.literal(true) })
export const threadViewMoveSchema = threadViewIdSchema.extend({ direction: z.enum(['earlier', 'later']) })
export const threadViewSelectSchema = z
  .object({ id: viewIdSchema.optional(), showGroupControl: z.boolean().optional(), showFilterControl: z.boolean().optional() })
  .strict()
  .refine(input => Object.keys(input).length > 0, 'Provide a view or visibility change.')

const output = z.object({ settings: threadViewSettingsSchema, revision: z.number().int().nonnegative() })
const viewOutput = z.object({
  view: threadViewCreateSchema.extend({ statusFilters: fields.statusFilters.readonly() }),
  revision: z.number().int().nonnegative(),
})
const render = (result: z.infer<typeof output>) => `${result.settings.views.length} saved thread views; selected ${result.settings.activeViewId}.`

export const threadViewsApi = defineApi({
  id: 'thread-sidebar-views',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: z.object({}).strict(),
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
