import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

/**
 * Group headers one browser keeps closed, keyed by the view group key
 * (`project:<workspaceId>` or `date:<bucket>`). Browser-local on purpose: the
 * Host settings schema knows only the fixed section names, and a Host-synced key
 * could not be written until the running Host restarts with the new schema.
 */
export const COLLAPSED_GROUPS_STORAGE_KEY = 'dshfiles.thread-sidebar.collapsed-groups.v1'

const collapsedGroupsSchema = z.array(z.string().min(1).max(200)).max(200)

export const storedCollapsedGroups = createStoredValue({
  key: COLLAPSED_GROUPS_STORAGE_KEY,
  schema: collapsedGroupsSchema,
  fallback: [] as readonly string[],
})

export const toggleCollapsedGroup = (collapsedGroups: readonly string[], key: string): string[] =>
  collapsedGroups.includes(key) ? collapsedGroups.filter(candidate => candidate !== key) : [...collapsedGroups, key]
