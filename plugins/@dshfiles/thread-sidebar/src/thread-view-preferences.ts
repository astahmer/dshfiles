import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as Option from 'effect/Option'
import {
  NOT_WORKING_REPLACEMENT_FILTERS,
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  THREAD_STORAGE_FILTERS,
  THREAD_WAITING_ON_YOU_FILTERS,
  ThreadViewModel,
  upgradeLegacyStatusFilters,
  type ThreadStatusFilter,
  type ThreadViewAttentionEntry,
  type ThreadViewPreferences,
} from './thread-view.js'
import { SchemaHelpers } from './schema-helpers.js'

export const ALL_THREADS_VIEW_ID = 'all-threads'
export const WORKING_VIEW_ID = 'working'
export const DONE_VIEW_ID = 'done'
export const INBOX_VIEW_ID = 'inbox'
export const GONE_VIEW_ID = 'gone'
export const LEGACY_CURRENT_VIEW_ID = 'legacy-current'
export const MAX_THREAD_VIEWS = 12
/** Built-in views ship with a translated name instead of a stored one. */
const BUILT_IN_VIEW_IDS = [ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, DONE_VIEW_ID, INBOX_VIEW_ID, GONE_VIEW_ID, LEGACY_CURRENT_VIEW_ID]

export interface ThreadViewPreset extends ThreadViewPreferences {
  readonly id: string
  readonly name: string | null
  readonly enabled: boolean
  readonly showCount?: boolean | undefined
  /**
   * The project scope the preset applies (filter presets, b:xpvk): a project id, `''` for Unassigned, `null` for All
   * projects. Absent: the preset leaves the project picker alone, as the built-in views always did.
   */
  readonly projectFilter?: string | null | undefined
}

export interface ThreadViewSettings {
  readonly views: readonly ThreadViewPreset[]
  readonly activeViewId: string
  readonly showGroupControl: boolean
  readonly showFilterControl: boolean
  /**
   * The list's filters once they were changed after a preset was applied; absent while the list shows the active
   * preset as saved. "Save changes" writes it into that preset, applying a preset drops it.
   */
  readonly draft?: ThreadViewPreferences | undefined
  /** The Filter menu's Presets section, the preset name on its trigger, the preset keys and ⌘K rows. */
  readonly showPresets: boolean
  /** A row of preset chips under the list header; off by default so the header stays calm. */
  readonly showPresetChips: boolean
}

export const DEFAULT_THREAD_VIEW_PRESETS = [
  {
    id: ALL_THREADS_VIEW_ID,
    name: null,
    // The ADE status grouping (plan §4.3); "Arrange manually" (`status`) stays one Group menu choice away.
    groupBy: 'state',
    statusFilters: [],
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: WORKING_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilters: ['working'],
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: DONE_VIEW_ID,
    name: null,
    groupBy: 'date',
    statusFilters: ['not-running', 'attention'],
    sourceFilter: 'main',
    enabled: true,
  },
] as const satisfies readonly [ThreadViewPreset, ThreadViewPreset, ThreadViewPreset]

export const DEFAULT_THREAD_VIEW_SETTINGS: ThreadViewSettings = {
  views: [...DEFAULT_THREAD_VIEW_PRESETS],
  // All threads, grouped by status, is the list a new profile opens on; a saved choice keeps its own view.
  activeViewId: ALL_THREADS_VIEW_ID,
  showGroupControl: true,
  showFilterControl: true,
  showPresets: true,
  showPresetChips: false,
}

export const doneViewFilterMigration = createStoredValue({
  key: 'dshfiles.thread-sidebar.done-view-filters.v1',
  schema: Schema.Boolean,
  fallback: false,
})

export const shippedViewFiltersMigration = createStoredValue({
  key: 'dshfiles.thread-sidebar.shipped-view-filters.v2',
  schema: Schema.Boolean,
  fallback: false,
})

const groupBySchema = Schema.Literals(THREAD_GROUP_BY_OPTIONS)
const statusFilterSchema = Schema.Literals(THREAD_STATUS_FILTER_OPTIONS)
const legacyStatusFilterSchema = Schema.Union([statusFilterSchema, Schema.Literal('not-working')])
const selectedStatusFilterSchema = Schema.Literals(THREAD_STATUS_FILTER_OPTIONS.filter((value): value is ThreadStatusFilter => value !== 'all'))
const legacySelectedStatusFilterSchema = Schema.Literals([
  ...THREAD_STATUS_FILTER_OPTIONS.filter((value): value is ThreadStatusFilter => value !== 'all'),
  'not-working',
])
const statusFiltersSchema = Schema.Array(legacySelectedStatusFilterSchema).pipe(
  Schema.decodeTo(Schema.Array(selectedStatusFilterSchema), {
    decode: SchemaGetter.transform(upgradeLegacyStatusFilters),
    encode: SchemaGetter.transform(value => value),
  }),
)
const sourceFilterSchema = Schema.Literals(THREAD_SOURCE_FILTER_OPTIONS)

const legacyThreadViewPreferencesSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    groupBy: SchemaHelpers.withDecodedDefault(groupBySchema, () => 'status'),
    statusFilter: SchemaHelpers.withDecodedDefault(legacyStatusFilterSchema, () => 'all'),
    sourceFilter: SchemaHelpers.withDecodedDefault(sourceFilterSchema, () => 'all'),
  }),
)

const threadViewPreferencesSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    groupBy: SchemaHelpers.withDecodedDefault(groupBySchema, () => 'status'),
    statusFilters: SchemaHelpers.withDecodedDefault(statusFiltersSchema, () => []),
    sourceFilter: SchemaHelpers.withDecodedDefault(sourceFilterSchema, () => 'all'),
  }),
)

const legacyThreadViewPresetSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)),
    name: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(32))),
    enabled: Schema.Boolean,
    groupBy: groupBySchema,
    statusFilter: legacyStatusFilterSchema,
    sourceFilter: sourceFilterSchema,
  }),
)

/** A project id, `''` for Unassigned or `null` for All projects: the values the project picker writes. */
export const projectFilterSchema = Schema.NullOr(Schema.String.check(Schema.isMaxLength(256)))

const threadViewPresetSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)),
    name: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(32))),
    enabled: Schema.Boolean,
    groupBy: groupBySchema,
    statusFilters: statusFiltersSchema,
    sourceFilter: sourceFilterSchema,
    showCount: Schema.optional(Schema.Boolean),
    projectFilter: Schema.optional(projectFilterSchema),
  }),
)

const threadViewDraftSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    groupBy: groupBySchema,
    statusFilters: statusFiltersSchema,
    sourceFilter: sourceFilterSchema,
  }),
)

const threadViewSettingsFields = {
  views: Schema.Array(threadViewPresetSchema).check(Schema.isMinLength(1)).check(Schema.isMaxLength(MAX_THREAD_VIEWS)),
  activeViewId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(64)),
  showGroupControl: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => true),
  showFilterControl: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => true),
  draft: Schema.optional(threadViewDraftSchema),
  showPresets: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => true),
  showPresetChips: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => false),
}

/** The whole saved-view document; the Host settings value and the browser's older copy share it. */
export const threadViewSettingsSchema = SchemaHelpers.strictStruct(Schema.Struct(threadViewSettingsFields))
  .check(
    Schema.makeFilter(settings => {
      const ids = new Set<string>()
      const names = new Set<string>()
      const issues: Array<Schema.FilterIssue> = []
      let enabledCount = 0

      for (const [index, view] of settings.views.entries()) {
        if (ids.has(view.id)) issues.push({ path: ['views', index, 'id'], issue: 'View ids must be unique.' })
        ids.add(view.id)
        if (view.name === null && !BUILT_IN_VIEW_IDS.includes(view.id)) {
          issues.push({ path: ['views', index, 'name'], issue: 'Custom views need a name.' })
        }
        if (view.name !== null) {
          const normalizedName = view.name.toLowerCase()
          if (names.has(normalizedName)) issues.push({ path: ['views', index, 'name'], issue: 'View names must be unique.' })
          names.add(normalizedName)
        }
        if (view.enabled) enabledCount += 1
      }

      if (enabledCount === 0) issues.push({ path: ['views'], issue: 'At least one view must be enabled.' })
      return issues
    }),
  )
  .pipe(
    Schema.decodeTo(Schema.toType(SchemaHelpers.strictStruct(Schema.Struct(threadViewSettingsFields))), {
      decode: SchemaGetter.transform(settings => {
        const activeView = settings.views.find(view => view.id === settings.activeViewId && view.enabled) ?? settings.views.find(view => view.enabled)
        return { ...settings, activeViewId: activeView?.id ?? ALL_THREADS_VIEW_ID }
      }),
      encode: SchemaGetter.transform(settings => settings),
    }),
  )

const migrateStatusFilter = (statusFilter: (typeof THREAD_STATUS_FILTER_OPTIONS)[number] | 'not-working'): readonly ThreadStatusFilter[] => {
  if (statusFilter === 'all') return []
  if (statusFilter === 'not-working') return [...NOT_WORKING_REPLACEMENT_FILTERS]
  return [statusFilter]
}

const legacyThreadViewSettingsSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    views: Schema.Array(legacyThreadViewPresetSchema).check(Schema.isMinLength(1)).check(Schema.isMaxLength(MAX_THREAD_VIEWS)),
    activeViewId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(64)),
    showGroupControl: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => true),
    showFilterControl: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => true),
  }),
)

const migrateLegacySettings = (legacy: typeof legacyThreadViewSettingsSchema.Type): ThreadViewSettings => ({
  showPresets: DEFAULT_THREAD_VIEW_SETTINGS.showPresets,
  showPresetChips: DEFAULT_THREAD_VIEW_SETTINGS.showPresetChips,
  ...legacy,
  views: legacy.views.map(({ statusFilter, ...view }) => ({ ...view, statusFilters: migrateStatusFilter(statusFilter) })),
})

const migrateLegacyPreferences = (legacy: typeof legacyThreadViewPreferencesSchema.Type): ThreadViewSettings => {
  const isDefaultView = legacy.groupBy === 'status' && legacy.sourceFilter === 'all' && (legacy.statusFilter === 'all' || legacy.statusFilter === 'working')
  if (isDefaultView) {
    return {
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      activeViewId: legacy.statusFilter === 'working' ? WORKING_VIEW_ID : ALL_THREADS_VIEW_ID,
    }
  }

  const currentView: ThreadViewPreset = {
    id: LEGACY_CURRENT_VIEW_ID,
    name: null,
    enabled: true,
    groupBy: legacy.groupBy,
    statusFilters: migrateStatusFilter(legacy.statusFilter),
    sourceFilter: legacy.sourceFilter,
  }
  return {
    ...DEFAULT_THREAD_VIEW_SETTINGS,
    views: [...DEFAULT_THREAD_VIEW_PRESETS, currentView],
    activeViewId: currentView.id,
  }
}

const storedThreadViewInputSchema = Schema.Union([threadViewSettingsSchema, legacyThreadViewSettingsSchema, legacyThreadViewPreferencesSchema])
const storedThreadViewSettingsSchema = storedThreadViewInputSchema.pipe(
  Schema.decodeTo(Schema.toType(threadViewSettingsSchema), {
    decode: SchemaGetter.transform(value => {
      if (Schema.is(legacyThreadViewPreferencesSchema)(value)) return migrateLegacyPreferences(value)
      if (Schema.is(legacyThreadViewSettingsSchema)(value)) return migrateLegacySettings(value)
      return value
    }),
    encode: SchemaGetter.transform(value => value),
  }),
)

const decodeThreadViewPreferences = (value: unknown): ThreadViewPreferences | null => {
  const result = Schema.decodeUnknownOption(threadViewPreferencesSchema)(value)
  return Option.isSome(result) ? result.value : null
}

const decodeThreadViewSettings = (value: unknown): ThreadViewSettings | null => {
  const result = Schema.decodeUnknownOption(storedThreadViewSettingsSchema)(value)
  return Option.isSome(result) ? result.value : null
}

const ensureDoneViewIncludesInactiveAndInterrupted = (settings: ThreadViewSettings): ThreadViewSettings => settings

const PREVIOUS_DEFAULT_THREAD_VIEW_PRESETS = [
  {
    id: ALL_THREADS_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilters: [],
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: WORKING_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilters: ['working'],
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: INBOX_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilters: [...THREAD_WAITING_ON_YOU_FILTERS],
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: GONE_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilters: [...THREAD_STORAGE_FILTERS],
    sourceFilter: 'all',
    enabled: true,
  },
] as const satisfies readonly ThreadViewPreset[]

const matchesDefaultPresets = (settings: ThreadViewSettings, presets: readonly ThreadViewPreset[]): boolean =>
  settings.views.length === presets.length &&
  settings.views.every((view, index) => {
    const preset = presets[index]
    return (
      preset !== undefined &&
      view.id === preset.id &&
      view.name === preset.name &&
      view.groupBy === preset.groupBy &&
      view.sourceFilter === preset.sourceFilter &&
      view.enabled === preset.enabled &&
      JSON.stringify(view.statusFilters) === JSON.stringify(preset.statusFilters)
    )
  })

/**
 * The status filters an earlier build shipped for its built-in Working and Done views. Working also listed
 * interrupted threads, which are not running; Done left out the threads a usage limit stopped.
 */
const PREVIOUS_SHIPPED_VIEW_FILTERS: Readonly<Record<string, readonly ThreadStatusFilter[]>> = {
  [WORKING_VIEW_ID]: ['working', 'interrupted'],
  [DONE_VIEW_ID]: ['inactive', 'interrupted'],
}

const sameStatusFilters = (left: readonly ThreadStatusFilter[], right: readonly ThreadStatusFilter[]): boolean =>
  left.length === right.length && left.every(filter => right.includes(filter))

/** Move built-in Working and Done views still on an earlier shipped filter set to today's; edited and custom views stay. */
const upgradeShippedViewFilters = (settings: ThreadViewSettings): ThreadViewSettings => {
  let changed = false
  const views = settings.views.map(view => {
    const previous = view.name === null ? PREVIOUS_SHIPPED_VIEW_FILTERS[view.id] : undefined
    const current = DEFAULT_THREAD_VIEW_PRESETS.find(preset => preset.id === view.id)
    if (previous === undefined || current === undefined) return view
    const matchesPrevious =
      sameStatusFilters(view.statusFilters, previous) ||
      (view.id === DONE_VIEW_ID && sameStatusFilters(view.statusFilters, ['inactive', 'interrupted', 'needs-resume']))
    if (!matchesPrevious) return view
    changed = true
    return { ...view, statusFilters: [...current.statusFilters] }
  })
  return changed ? { ...settings, views } : settings
}

const matchesPreviousFiveViewDefaults = (settings: ThreadViewSettings): boolean =>
  ([['working'], ['working', 'interrupted']] satisfies readonly (readonly ThreadStatusFilter[])[]).some(workingFilters =>
    (
      [
        ['inactive', 'interrupted'],
        ['inactive', 'interrupted', 'needs-resume'],
      ] satisfies readonly (readonly ThreadStatusFilter[])[]
    ).some(doneFilters =>
      matchesDefaultPresets(settings, [
        DEFAULT_THREAD_VIEW_PRESETS[0],
        { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: workingFilters },
        { id: DONE_VIEW_ID, name: null, enabled: true, groupBy: 'status', sourceFilter: 'main', statusFilters: doneFilters },
        ...PREVIOUS_DEFAULT_THREAD_VIEW_PRESETS.slice(2),
      ]),
    ),
  )

/** The three built-in views as shipped before the status grouping became the All threads default. */
const PRE_STATE_GROUPING_PRESETS: readonly ThreadViewPreset[] = [
  { ...DEFAULT_THREAD_VIEW_PRESETS[0], groupBy: 'status' },
  DEFAULT_THREAD_VIEW_PRESETS[1],
  DEFAULT_THREAD_VIEW_PRESETS[2],
]

const isDefaultThreadViewSettings = (settings: ThreadViewSettings): boolean =>
  settings.showGroupControl &&
  settings.showFilterControl &&
  (matchesDefaultPresets(upgradeShippedViewFilters(settings), DEFAULT_THREAD_VIEW_PRESETS) ||
    matchesDefaultPresets(upgradeShippedViewFilters(settings), PRE_STATE_GROUPING_PRESETS) ||
    matchesDefaultPresets(settings, PREVIOUS_DEFAULT_THREAD_VIEW_PRESETS) ||
    matchesPreviousFiveViewDefaults(settings)) &&
  settings.views.some(view => view.id === settings.activeViewId)

const migrateDoneViewSettings = (settings: ThreadViewSettings): ThreadViewSettings => upgradeShippedViewFilters(settings)

const activeThreadView = (settings: ThreadViewSettings): ThreadViewPreset =>
  settings.views.find(view => view.id === settings.activeViewId && view.enabled) ?? settings.views.find(view => view.enabled) ?? DEFAULT_THREAD_VIEW_PRESETS[0]

const attentionLabelForPreset = (view: ThreadViewPreset, entries: readonly ThreadViewAttentionEntry[]) => {
  if (view.id === ALL_THREADS_VIEW_ID) return undefined
  return ThreadViewModel.attentionLabelForView({ filters: view.statusFilters, sourceFilter: view.sourceFilter, entries })
}

const unreadCountForPreset = (view: ThreadViewPreset, entries: readonly ThreadViewAttentionEntry[]): number => {
  if (view.id === ALL_THREADS_VIEW_ID) return 0
  return ThreadViewModel.unreadCountForView({ filters: view.statusFilters, sourceFilter: view.sourceFilter, entries })
}

const selectThreadView = (settings: ThreadViewSettings, viewId: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  return view?.enabled ? { ...settings, activeViewId: view.id } : settings
}

const saveThreadView = (settings: ThreadViewSettings, view: ThreadViewPreset): ThreadViewSettings => {
  const exists = settings.views.some(candidate => candidate.id === view.id)
  const views = exists ? settings.views.map(candidate => (candidate.id === view.id ? view : candidate)) : [...settings.views, view]
  return { ...settings, views }
}

const moveThreadView = (settings: ThreadViewSettings, viewId: string, direction: -1 | 1): ThreadViewSettings => {
  const index = settings.views.findIndex(view => view.id === viewId)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= settings.views.length) return settings
  const views = [...settings.views]
  const view = views[index]
  const targetView = views[targetIndex]
  if (view === undefined || targetView === undefined) return settings
  views[index] = targetView
  views[targetIndex] = view
  return { ...settings, views }
}

const setThreadViewEnabled = (settings: ThreadViewSettings, viewId: string, enabled: boolean): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (view === undefined || view.enabled === enabled) return settings
  if (!enabled && settings.views.filter(candidate => candidate.enabled).length === 1) return settings
  const views = settings.views.map(candidate => (candidate.id === viewId ? { ...candidate, enabled } : candidate))
  const activeViewId =
    settings.activeViewId === viewId && !enabled ? (views.find(candidate => candidate.enabled)?.id ?? ALL_THREADS_VIEW_ID) : settings.activeViewId
  // A draft is relative to the active preset: it goes with it.
  const { draft, ...rest } = settings
  return activeViewId === settings.activeViewId && draft !== undefined ? { ...rest, draft, views, activeViewId } : { ...rest, views, activeViewId }
}

const removeThreadView = (settings: ThreadViewSettings, viewId: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (settings.views.length === 1 || view === undefined) return settings
  if (view.enabled && settings.views.filter(candidate => candidate.enabled).length === 1) return settings
  const views = settings.views.filter(candidate => candidate.id !== viewId)
  const activeViewId = settings.activeViewId === viewId ? (views.find(view => view.enabled)?.id ?? ALL_THREADS_VIEW_ID) : settings.activeViewId
  const { draft, ...rest } = settings
  return activeViewId === settings.activeViewId && draft !== undefined ? { ...rest, draft, views, activeViewId } : { ...rest, views, activeViewId }
}

// Filter presets (b:xpvk): a saved view is a preset; changing a filter after applying one keeps a draft beside it, so
// the preset stays as saved until the user saves the changes into it.

const filtersOf = (view: ThreadViewPreferences): ThreadViewPreferences => ({
  groupBy: view.groupBy,
  statusFilters: [...view.statusFilters],
  sourceFilter: view.sourceFilter,
})

const sameThreadViewFilters = (left: ThreadViewPreferences, right: ThreadViewPreferences): boolean =>
  left.groupBy === right.groupBy && left.sourceFilter === right.sourceFilter && sameStatusFilters(left.statusFilters, right.statusFilters)

const withoutDraft = (settings: ThreadViewSettings): ThreadViewSettings => {
  const { draft: _draft, ...rest } = settings
  return rest
}

/** The filters the list shows: the draft once the user changed one, else the active preset's. */
const currentThreadViewFilters = (settings: ThreadViewSettings): ThreadViewPreferences => settings.draft ?? filtersOf(activeThreadView(settings))

/**
 * Change the list's filters. With presets on the saved preset stays as it is and the change is a draft beside it (a
 * change back to the preset's own filters drops the draft); with presets off the change rewrites the active view, as
 * before presets.
 */
const editThreadViewFilters = (settings: ThreadViewSettings, patch: Partial<ThreadViewPreferences>): ThreadViewSettings => {
  if (!settings.showPresets) return updateThreadViewPreferences(withoutDraft(settings), patch)
  const current = currentThreadViewFilters(settings)
  const next = filtersOf({ ...current, ...patch })
  return sameThreadViewFilters(next, activeThreadView(settings)) ? withoutDraft(settings) : { ...withoutDraft(settings), draft: next }
}

/** Whether the list no longer shows the active preset as saved: a changed filter, or a project scope the preset names. */
const isThreadViewEdited = (settings: ThreadViewSettings, workspaceFilter: string | null): boolean => {
  if (settings.draft !== undefined) return true
  const projectFilter = activeThreadView(settings).projectFilter
  return projectFilter !== undefined && projectFilter !== workspaceFilter
}

export interface AppliedThreadViewPreset {
  readonly settings: ThreadViewSettings
  /** The project scope to set with it; absent when the preset leaves the project picker alone. */
  readonly workspaceFilter?: string | null
}

/** Apply an enabled preset: it becomes active, any draft goes, and a preset that names a project scope sets it. */
const applyThreadViewPreset = (settings: ThreadViewSettings, viewId: string): AppliedThreadViewPreset => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (view === undefined || !view.enabled) return { settings }
  const applied = { ...withoutDraft(settings), activeViewId: view.id }
  return view.projectFilter === undefined ? { settings: applied } : { settings: applied, workspaceFilter: view.projectFilter }
}

/**
 * Write the list's current filters into one preset ("Save changes", "Update with current filters"). The project scope
 * joins it when the preset already names one or the list is scoped to a project; a project-neutral preset updated on
 * All projects stays neutral.
 */
const saveCurrentFiltersToPreset = (settings: ThreadViewSettings, viewId: string, workspaceFilter: string | null): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (view === undefined) return settings
  const filters = currentThreadViewFilters(settings)
  const projectFilter = view.projectFilter !== undefined || workspaceFilter !== null ? workspaceFilter : undefined
  const { projectFilter: _previous, ...rest } = view
  const updated: ThreadViewPreset = projectFilter === undefined ? { ...rest, ...filters } : { ...rest, ...filters, projectFilter }
  const saved = saveThreadView(settings, updated)
  return view.id === activeThreadView(settings).id ? withoutDraft(saved) : saved
}

/** Save the list's current filters and project scope as a new preset at `position` (default: last) and apply it. */
const createPresetFromCurrent = (
  settings: ThreadViewSettings,
  input: { readonly id: string; readonly name: string; readonly workspaceFilter: string | null; readonly position?: number },
): ThreadViewSettings => {
  const view: ThreadViewPreset = {
    id: input.id,
    name: input.name.trim(),
    enabled: true,
    ...currentThreadViewFilters(settings),
    projectFilter: input.workspaceFilter,
  }
  return { ...withoutDraft(insertThreadView(settings, view, input.position)), activeViewId: view.id }
}

/**
 * Turn presets on or off. Turning them off folds an unsaved draft into the active view, which is what the list then
 * shows and what a filter change would have done before presets.
 */
const setPresetsEnabled = (settings: ThreadViewSettings, enabled: boolean): ThreadViewSettings => {
  if (enabled || settings.draft === undefined) return { ...settings, showPresets: enabled }
  return { ...updateThreadViewPreferences(withoutDraft(settings), settings.draft), showPresets: false }
}

/** Put a view at `position` (clamped; default last): the Undo of a delete puts it back where it was. */
const insertThreadView = (settings: ThreadViewSettings, view: ThreadViewPreset, position?: number): ThreadViewSettings => {
  const others = settings.views.filter(candidate => candidate.id !== view.id)
  const index = position === undefined ? others.length : Math.max(0, Math.min(position, others.length))
  return { ...settings, views: [...others.slice(0, index), view, ...others.slice(index)] }
}

const renameThreadView = (settings: ThreadViewSettings, viewId: string, name: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  return view === undefined ? settings : saveThreadView(settings, { ...view, name: name.trim() })
}

/** The enabled preset `direction` steps from the active one, wrapping; the `[` and `]` keys. */
const adjacentThreadViewId = (settings: ThreadViewSettings, direction: -1 | 1): string | undefined => {
  const enabled = settings.views.filter(view => view.enabled)
  if (enabled.length === 0) return undefined
  const index = enabled.findIndex(view => view.id === activeThreadView(settings).id)
  return enabled[(index + direction + enabled.length) % enabled.length]?.id
}

/** A new preset id; getRandomValues also works on plain HTTP LAN pages, unlike randomUUID. */
const newThreadViewId = (): string => `custom-${Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')}`

/** The browser copy this plugin wrote before the saved views became Host settings; read once to migrate. */
export const threadViewPreferences = createStoredValue({
  key: 'dshfiles.thread-sidebar.view.v1',
  schema: storedThreadViewSettingsSchema,
  fallback: DEFAULT_THREAD_VIEW_SETTINGS,
})

/** Apply one view's group/filter change to the saved-view document. */
const updateThreadViewPreferences = (settings: ThreadViewSettings, patch: Partial<ThreadViewPreferences>): ThreadViewSettings => {
  const active = activeThreadView(settings)
  const views = settings.views.map(view => {
    if (view.id !== active.id) return { ...view, statusFilters: [...view.statusFilters] }
    return { ...view, ...patch, statusFilters: [...(patch.statusFilters ?? view.statusFilters)] }
  })
  return { ...settings, views }
}

const updateThreadViewSettings = (settings: ThreadViewSettings): ThreadViewSettings => ({
  ...settings,
  views: settings.views.map(view => ({ ...view, statusFilters: [...view.statusFilters] })),
})

export class ThreadViewPreferencesModel {
  static readonly decodeThreadViewPreferences = decodeThreadViewPreferences
  static readonly decodeThreadViewSettings = decodeThreadViewSettings
  static readonly ensureDoneViewIncludesInactiveAndInterrupted = ensureDoneViewIncludesInactiveAndInterrupted
  static readonly isDefaultThreadViewSettings = isDefaultThreadViewSettings
  static readonly migrateDoneViewSettings = migrateDoneViewSettings
  static readonly upgradeShippedViewFilters = upgradeShippedViewFilters
  static readonly activeThreadView = activeThreadView
  static readonly attentionLabelForPreset = attentionLabelForPreset
  static readonly unreadCountForPreset = unreadCountForPreset
  static readonly selectThreadView = selectThreadView
  static readonly saveThreadView = saveThreadView
  static readonly moveThreadView = moveThreadView
  static readonly setThreadViewEnabled = setThreadViewEnabled
  static readonly removeThreadView = removeThreadView
  static readonly updateThreadViewPreferences = updateThreadViewPreferences
  static readonly updateThreadViewSettings = updateThreadViewSettings
  static readonly currentThreadViewFilters = currentThreadViewFilters
  static readonly sameThreadViewFilters = sameThreadViewFilters
  static readonly editThreadViewFilters = editThreadViewFilters
  static readonly setPresetsEnabled = setPresetsEnabled
  static readonly isThreadViewEdited = isThreadViewEdited
  static readonly applyThreadViewPreset = applyThreadViewPreset
  static readonly saveCurrentFiltersToPreset = saveCurrentFiltersToPreset
  static readonly createPresetFromCurrent = createPresetFromCurrent
  static readonly insertThreadView = insertThreadView
  static readonly renameThreadView = renameThreadView
  static readonly adjacentThreadViewId = adjacentThreadViewId
  static readonly newThreadViewId = newThreadViewId
}
