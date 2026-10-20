import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

/**
 * Group headers a user keeps closed, keyed by the view group key
 * (`project:<workspaceId>` or `date:<bucket>`).
 *
 * The collapse state is the Host-synced `collapsedGroups` preference; the
 * browser key below only holds the copy an earlier build wrote, which
 * `ThreadSidebarContent` hands over once and then removes.
 */
export const COLLAPSED_GROUPS_STORAGE_KEY = 'dshfiles.thread-sidebar.collapsed-groups.v1'

const collapsedGroupsSchema = z.array(z.string().min(1).max(200)).max(200)

const noCollapsedGroups: readonly string[] = []

export const storedCollapsedGroups = createStoredValue({
  key: COLLAPSED_GROUPS_STORAGE_KEY,
  schema: collapsedGroupsSchema,
  fallback: noCollapsedGroups,
})

export const toggleCollapsedGroup = (collapsedGroups: readonly string[], key: string): string[] =>
  collapsedGroups.includes(key) ? collapsedGroups.filter(candidate => candidate !== key) : [...collapsedGroups, key]
