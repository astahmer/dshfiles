import { createEffectStoredValue } from './effect-stored-value.js'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as Option from 'effect/Option'
import { SIDEBAR_SECTIONS, type SidebarSection } from './organization.js'
import {
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  upgradeLegacyStatusFilters,
  type ThreadStatusFilter,
  type ThreadViewPreferences,
} from './thread-view.js'
import { SchemaHelpers } from './schema-helpers.js'

export interface ThreadBoardViewSettings extends ThreadViewPreferences {
  readonly projectFilter: string | null
  readonly collapsedGroups: readonly string[]
  readonly collapsedSections: readonly SidebarSection[]
}

export const DEFAULT_THREAD_BOARD_VIEW: ThreadBoardViewSettings = {
  groupBy: 'status',
  statusFilters: [],
  sourceFilter: 'all',
  projectFilter: null,
  collapsedGroups: [],
  collapsedSections: [],
}

const groupBySchema = Schema.Literals(THREAD_GROUP_BY_OPTIONS)
const sourceFilterSchema = Schema.Literals(THREAD_SOURCE_FILTER_OPTIONS)
const statusFilterSchema = Schema.Literals(THREAD_STATUS_FILTER_OPTIONS.filter((filter): filter is ThreadStatusFilter => filter !== 'all'))

export const threadBoardViewSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    groupBy: groupBySchema,
    statusFilters: Schema.Array(
      Schema.Literals([...THREAD_STATUS_FILTER_OPTIONS.filter((filter): filter is ThreadStatusFilter => filter !== 'all'), 'not-working']),
    ).pipe(
      Schema.decodeTo(Schema.Array(statusFilterSchema).check(Schema.isMaxLength(THREAD_STATUS_FILTER_OPTIONS.length - 1)), {
        decode: SchemaGetter.transform(upgradeLegacyStatusFilters),
        encode: SchemaGetter.transform(value => value),
      }),
    ),
    sourceFilter: sourceFilterSchema,
    projectFilter: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
    collapsedGroups: Schema.Array(Schema.String.check(Schema.isMaxLength(160))).check(Schema.isMaxLength(64)),
    collapsedSections: Schema.Array(Schema.Literals(SIDEBAR_SECTIONS)).check(Schema.isMaxLength(SIDEBAR_SECTIONS.length)),
  }),
).check(
  Schema.makeFilter(settings =>
    new Set(settings.statusFilters).size === settings.statusFilters.length ? undefined : { path: ['statusFilters'], issue: 'Status filters must be unique.' },
  ),
)

export const storedThreadBoardView = createEffectStoredValue({
  key: 'dshfiles.thread-sidebar.board-view.v1',
  schema: threadBoardViewSchema,
  fallback: DEFAULT_THREAD_BOARD_VIEW,
})

export class ThreadBoardViewModel {
  static readonly update = (
    current: ThreadBoardViewSettings,
    patch: Partial<Pick<ThreadBoardViewSettings, 'groupBy' | 'statusFilters' | 'sourceFilter' | 'projectFilter' | 'collapsedGroups' | 'collapsedSections'>>,
  ): ThreadBoardViewSettings => {
    const result = Schema.decodeUnknownOption(threadBoardViewSchema)({ ...current, ...patch })
    return Option.isSome(result) ? result.value : current
  }
}
