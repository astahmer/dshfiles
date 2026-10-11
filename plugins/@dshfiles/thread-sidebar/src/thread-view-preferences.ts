import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_OPTIONS, type ThreadViewPreferences } from './thread-view.js'

export const DEFAULT_THREAD_VIEW_PREFERENCES: ThreadViewPreferences = {
  groupBy: 'status',
  statusFilter: 'all',
  sourceFilter: 'all',
}

const groupBySchema = z.enum(THREAD_GROUP_BY_OPTIONS)
const statusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS)
const sourceFilterSchema = z.enum(THREAD_SOURCE_FILTER_OPTIONS)

const threadViewPreferencesSchema = z
  .object({
    groupBy: groupBySchema.default(DEFAULT_THREAD_VIEW_PREFERENCES.groupBy),
    statusFilter: statusFilterSchema.default(DEFAULT_THREAD_VIEW_PREFERENCES.statusFilter),
    sourceFilter: sourceFilterSchema.default(DEFAULT_THREAD_VIEW_PREFERENCES.sourceFilter),
  })
  .strict()

export const decodeThreadViewPreferences = (value: unknown): ThreadViewPreferences | null => {
  const result = threadViewPreferencesSchema.safeParse(value)
  return result.success ? result.data : null
}

export const threadViewPreferences = createStoredValue({
  key: 'dshfiles.thread-sidebar.view.v1',
  schema: threadViewPreferencesSchema,
  fallback: DEFAULT_THREAD_VIEW_PREFERENCES,
})

export const updateThreadViewPreferences = (patch: Partial<ThreadViewPreferences>): boolean => {
  const current = threadViewPreferences.get() ?? DEFAULT_THREAD_VIEW_PREFERENCES
  return threadViewPreferences.set({ ...current, ...patch })
}
