import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
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

export const ALL_THREADS_VIEW_ID = 'all-threads'
export const WORKING_VIEW_ID = 'working'
export const INBOX_VIEW_ID = 'inbox'
export const GONE_VIEW_ID = 'gone'
export const LEGACY_CURRENT_VIEW_ID = 'legacy-current'
export const MAX_THREAD_VIEWS = 12
/** Built-in views ship with a translated name instead of a stored one. */
const BUILT_IN_VIEW_IDS = [ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, INBOX_VIEW_ID, GONE_VIEW_ID, LEGACY_CURRENT_VIEW_ID]

export interface ThreadViewPreset extends ThreadViewPreferences {
  readonly id: string
  readonly name: string | null
  readonly enabled: boolean
}

export interface ThreadViewSettings {
  readonly views: readonly ThreadViewPreset[]
  readonly activeViewId: string
  readonly showGroupControl: boolean
  readonly showFilterControl: boolean
}

export const DEFAULT_THREAD_VIEW_PRESETS = [
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
] as const satisfies readonly [ThreadViewPreset, ThreadViewPreset, ThreadViewPreset, ThreadViewPreset]

export const DEFAULT_THREAD_VIEW_SETTINGS: ThreadViewSettings = {
  views: [...DEFAULT_THREAD_VIEW_PRESETS],
  activeViewId: ALL_THREADS_VIEW_ID,
  showGroupControl: true,
  showFilterControl: true,
}

const groupBySchema = z.enum(THREAD_GROUP_BY_OPTIONS)
const statusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS)
const legacyStatusFilterSchema = z.union([statusFilterSchema, z.literal('not-working')])
const selectedStatusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS.filter(value => value !== 'all'))
const statusFiltersSchema = z.preprocess(value => (Array.isArray(value) ? upgradeLegacyStatusFilters(value) : value), z.array(selectedStatusFilterSchema))
const sourceFilterSchema = z.enum(THREAD_SOURCE_FILTER_OPTIONS)

const legacyThreadViewPreferencesSchema = z
  .object({
    groupBy: groupBySchema.default('status'),
    statusFilter: legacyStatusFilterSchema.default('all'),
    sourceFilter: sourceFilterSchema.default('all'),
  })
  .strict()

const threadViewPreferencesSchema = z
  .object({
    groupBy: groupBySchema.default('status'),
    statusFilters: statusFiltersSchema.default([]),
    sourceFilter: sourceFilterSchema.default('all'),
  })
  .strict()

const legacyThreadViewPresetSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u),
    name: z.string().trim().min(1).max(32).nullable(),
    enabled: z.boolean(),
    groupBy: groupBySchema,
    statusFilter: legacyStatusFilterSchema,
    sourceFilter: sourceFilterSchema,
  })
  .strict()

const threadViewPresetSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u),
    name: z.string().trim().min(1).max(32).nullable(),
    enabled: z.boolean(),
    groupBy: groupBySchema,
    statusFilters: statusFiltersSchema.readonly(),
    sourceFilter: sourceFilterSchema,
  })
  .strict()

/** The whole saved-view document; the Host settings value and the browser's older copy share it. */
export const threadViewSettingsSchema = z
  .object({
    views: z.array(threadViewPresetSchema).min(1).max(MAX_THREAD_VIEWS).readonly(),
    activeViewId: z.string().min(1).max(64),
    showGroupControl: z.boolean().default(true),
    showFilterControl: z.boolean().default(true),
  })
  .strict()
  .superRefine((settings, context) => {
    const ids = new Set<string>()
    const names = new Set<string>()
    let enabledCount = 0

    for (const [index, view] of settings.views.entries()) {
      if (ids.has(view.id)) {
        context.addIssue({ code: 'custom', path: ['views', index, 'id'], message: 'View ids must be unique.' })
      }
      ids.add(view.id)
      if (view.name === null && !BUILT_IN_VIEW_IDS.includes(view.id)) {
        context.addIssue({ code: 'custom', path: ['views', index, 'name'], message: 'Custom views need a name.' })
      }
      if (view.name !== null) {
        const normalizedName = view.name.toLowerCase()
        if (names.has(normalizedName)) {
          context.addIssue({ code: 'custom', path: ['views', index, 'name'], message: 'View names must be unique.' })
        }
        names.add(normalizedName)
      }
      if (view.enabled) enabledCount += 1
    }

    if (enabledCount === 0) context.addIssue({ code: 'custom', path: ['views'], message: 'At least one view must be enabled.' })
  })
  .transform(settings => {
    const activeView = settings.views.find(view => view.id === settings.activeViewId && view.enabled) ?? settings.views.find(view => view.enabled)
    return { ...settings, activeViewId: activeView?.id ?? ALL_THREADS_VIEW_ID }
  })

const migrateStatusFilter = (statusFilter: (typeof THREAD_STATUS_FILTER_OPTIONS)[number] | 'not-working'): readonly ThreadStatusFilter[] => {
  if (statusFilter === 'all') return []
  if (statusFilter === 'not-working') return [...NOT_WORKING_REPLACEMENT_FILTERS]
  return [statusFilter]
}

const legacyThreadViewSettingsSchema = z
  .object({
    views: z.array(legacyThreadViewPresetSchema).min(1).max(MAX_THREAD_VIEWS),
    activeViewId: z.string().min(1).max(64),
    showGroupControl: z.boolean().default(true),
    showFilterControl: z.boolean().default(true),
  })
  .strict()

const migrateLegacySettings = (legacy: z.infer<typeof legacyThreadViewSettingsSchema>): ThreadViewSettings => ({
  ...legacy,
  views: legacy.views.map(({ statusFilter, ...view }) => ({ ...view, statusFilters: migrateStatusFilter(statusFilter) })),
})

const migrateLegacyPreferences = (legacy: z.infer<typeof legacyThreadViewPreferencesSchema>): ThreadViewSettings => {
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

const storedThreadViewSettingsSchema = z.preprocess(value => {
  const current = threadViewSettingsSchema.safeParse(value)
  if (current.success) return current.data
  const legacySettings = legacyThreadViewSettingsSchema.safeParse(value)
  if (legacySettings.success) return migrateLegacySettings(legacySettings.data)
  const legacyPreferences = legacyThreadViewPreferencesSchema.safeParse(value)
  return legacyPreferences.success ? migrateLegacyPreferences(legacyPreferences.data) : value
}, threadViewSettingsSchema)

const decodeThreadViewPreferences = (value: unknown): ThreadViewPreferences | null => {
  const result = threadViewPreferencesSchema.safeParse(value)
  return result.success ? result.data : null
}

const decodeThreadViewSettings = (value: unknown): ThreadViewSettings | null => {
  const result = storedThreadViewSettingsSchema.safeParse(value)
  return result.success ? result.data : null
}

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
  return { ...settings, views, activeViewId }
}

const removeThreadView = (settings: ThreadViewSettings, viewId: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (settings.views.length === 1 || view === undefined) return settings
  if (view.enabled && settings.views.filter(candidate => candidate.enabled).length === 1) return settings
  const views = settings.views.filter(candidate => candidate.id !== viewId)
  const activeViewId = settings.activeViewId === viewId ? (views.find(view => view.enabled)?.id ?? ALL_THREADS_VIEW_ID) : settings.activeViewId
  return { ...settings, views, activeViewId }
}

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
}
