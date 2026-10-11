import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_OPTIONS, type ThreadViewPreferences } from './thread-view.js'

export const ALL_THREADS_VIEW_ID = 'all-threads'
export const WORKING_VIEW_ID = 'working'
export const LEGACY_CURRENT_VIEW_ID = 'legacy-current'
export const MAX_THREAD_VIEWS = 12

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
    statusFilter: 'all',
    sourceFilter: 'all',
    enabled: true,
  },
  {
    id: WORKING_VIEW_ID,
    name: null,
    groupBy: 'status',
    statusFilter: 'working',
    sourceFilter: 'all',
    enabled: true,
  },
] as const satisfies readonly [ThreadViewPreset, ThreadViewPreset]

export const DEFAULT_THREAD_VIEW_SETTINGS: ThreadViewSettings = {
  views: DEFAULT_THREAD_VIEW_PRESETS,
  activeViewId: ALL_THREADS_VIEW_ID,
  showGroupControl: true,
  showFilterControl: true,
}

const groupBySchema = z.enum(THREAD_GROUP_BY_OPTIONS)
const statusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS)
const sourceFilterSchema = z.enum(THREAD_SOURCE_FILTER_OPTIONS)

const singleThreadViewPreferencesSchema = z
  .object({
    groupBy: groupBySchema.default('status'),
    statusFilter: statusFilterSchema.default('all'),
    sourceFilter: sourceFilterSchema.default('all'),
  })
  .strict()

const threadViewPresetSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u),
    name: z.string().trim().min(1).max(32).nullable(),
    enabled: z.boolean(),
    groupBy: groupBySchema,
    statusFilter: statusFilterSchema,
    sourceFilter: sourceFilterSchema,
  })
  .strict()

const threadViewSettingsSchema = z
  .object({
    views: z.array(threadViewPresetSchema).min(1).max(MAX_THREAD_VIEWS),
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
      if (view.name === null && ![ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, LEGACY_CURRENT_VIEW_ID].includes(view.id)) {
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

const migrateLegacyPreferences = (legacy: ThreadViewPreferences): ThreadViewSettings => {
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
    ...legacy,
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
  const legacy = singleThreadViewPreferencesSchema.safeParse(value)
  return legacy.success ? migrateLegacyPreferences(legacy.data) : value
}, threadViewSettingsSchema)

export const decodeThreadViewPreferences = (value: unknown): ThreadViewPreferences | null => {
  const result = singleThreadViewPreferencesSchema.safeParse(value)
  return result.success ? result.data : null
}

export const decodeThreadViewSettings = (value: unknown): ThreadViewSettings | null => {
  const result = storedThreadViewSettingsSchema.safeParse(value)
  return result.success ? result.data : null
}

export const activeThreadView = (settings: ThreadViewSettings): ThreadViewPreset =>
  settings.views.find(view => view.id === settings.activeViewId && view.enabled) ?? settings.views.find(view => view.enabled) ?? DEFAULT_THREAD_VIEW_PRESETS[0]

export const selectThreadView = (settings: ThreadViewSettings, viewId: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  return view?.enabled ? { ...settings, activeViewId: view.id } : settings
}

export const saveThreadView = (settings: ThreadViewSettings, view: ThreadViewPreset): ThreadViewSettings => {
  const exists = settings.views.some(candidate => candidate.id === view.id)
  const views = exists ? settings.views.map(candidate => (candidate.id === view.id ? view : candidate)) : [...settings.views, view]
  return { ...settings, views }
}

export const moveThreadView = (settings: ThreadViewSettings, viewId: string, direction: -1 | 1): ThreadViewSettings => {
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

export const setThreadViewEnabled = (settings: ThreadViewSettings, viewId: string, enabled: boolean): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (view === undefined || view.enabled === enabled) return settings
  if (!enabled && settings.views.filter(candidate => candidate.enabled).length === 1) return settings
  const views = settings.views.map(candidate => (candidate.id === viewId ? { ...candidate, enabled } : candidate))
  const activeViewId =
    settings.activeViewId === viewId && !enabled ? (views.find(candidate => candidate.enabled)?.id ?? ALL_THREADS_VIEW_ID) : settings.activeViewId
  return { ...settings, views, activeViewId }
}

export const removeThreadView = (settings: ThreadViewSettings, viewId: string): ThreadViewSettings => {
  const view = settings.views.find(candidate => candidate.id === viewId)
  if (settings.views.length === 1 || view === undefined) return settings
  if (view.enabled && settings.views.filter(candidate => candidate.enabled).length === 1) return settings
  const views = settings.views.filter(candidate => candidate.id !== viewId)
  const activeViewId = settings.activeViewId === viewId ? (views.find(view => view.enabled)?.id ?? ALL_THREADS_VIEW_ID) : settings.activeViewId
  return { ...settings, views, activeViewId }
}

export const threadViewPreferences = createStoredValue({
  key: 'dshfiles.thread-sidebar.view.v1',
  schema: storedThreadViewSettingsSchema,
  fallback: DEFAULT_THREAD_VIEW_SETTINGS,
})

export const updateThreadViewPreferences = (patch: Partial<ThreadViewPreferences>): boolean => {
  const current = threadViewPreferences.get() ?? DEFAULT_THREAD_VIEW_SETTINGS
  const active = activeThreadView(current)
  const views = current.views.map(view => (view.id === active.id ? { ...view, ...patch } : view))
  return threadViewPreferences.set({ ...current, views })
}

export const updateThreadViewSettings = (settings: ThreadViewSettings): boolean => threadViewPreferences.set({ ...settings, views: [...settings.views] })
