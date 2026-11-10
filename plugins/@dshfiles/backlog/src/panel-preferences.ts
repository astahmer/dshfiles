import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Effect, Schema } from 'effect'
import { BacklogItems, type BacklogStatus } from './item.js'
import { BacklogShipped } from './shipped.js'
import { BACKLOG_PANEL_ID } from './panel-draft.js'

export const views = ['feed', 'inbox', 'items', 'board', 'projects', 'shipped', 'ready'] as const
const sortOrderSchema = Schema.Literals(['updated', 'created', 'priority', 'due'])
const defaultSort = { feed: 'updated', inbox: 'updated', items: 'updated' } as const
const hideAgentItemsDefaults = { feed: true, inbox: true, ready: true, items: true, board: true, projects: true, shipped: true, search: true } as const
const hiddenByDefault = Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))
const preferencesSchema = Schema.Struct({
  view: Schema.Literals(views),
  groupBy: Schema.Literals(['status', 'kind', 'project', 'attention', 'priority', 'parent', 'due']),
  showDormant: Schema.Boolean,
  statuses: Schema.Array(Schema.Literals(BacklogItems.statuses)).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  project: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  projects: Schema.Array(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  sort: Schema.Struct({
    feed: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
    inbox: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
    items: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultSort))),
  hideAgentItems: Schema.Struct({
    feed: hiddenByDefault,
    inbox: hiddenByDefault,
    ready: hiddenByDefault,
    items: hiddenByDefault,
    board: hiddenByDefault,
    projects: hiddenByDefault,
    shipped: hiddenByDefault,
    search: hiddenByDefault,
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(hideAgentItemsDefaults))),
  shippedPeriod: Schema.Literals(BacklogShipped.unitPeriods).pipe(Schema.withDecodingDefaultKey(Effect.succeed('week'))),
})
const panelStorageKey = (base: string, panelId: string | undefined): string =>
  panelId === undefined || panelId === BACKLOG_PANEL_ID ? base : `${base}/panel/${encodeURIComponent(panelId)}`

export const boardStatuses: readonly BacklogStatus[] = ['inbox', 'todo', 'doing', 'done', 'dropped']
const boardStatusSchema = Schema.Literals(['inbox', 'todo', 'doing', 'done', 'dropped'])
const noHiddenColumns: readonly BacklogStatus[] = []
export const boardColumnsFor = (panelId: string | undefined) =>
  createStoredValue({
    key: panelStorageKey('dshfiles.backlog.board-columns.v1', panelId),
    schema: Schema.Struct({ order: Schema.Array(boardStatusSchema), hidden: Schema.Array(boardStatusSchema) }),
    fallback: { order: [...boardStatuses], hidden: noHiddenColumns },
  })

export const panelPreferences = (panelId: string | undefined) =>
  createStoredValue({
    key: panelStorageKey('dshfiles.backlog.view.v2', panelId),
    schema: preferencesSchema,
    fallback: {
      view: 'feed' as const,
      groupBy: 'status' as const,
      showDormant: false,
      statuses: [],
      project: null,
      projects: [],
      sort: defaultSort,
      hideAgentItems: hideAgentItemsDefaults,
      shippedPeriod: 'week' as const,
    },
  })
