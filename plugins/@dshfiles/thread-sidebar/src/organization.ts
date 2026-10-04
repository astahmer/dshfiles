import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

export type SidebarSection = 'pinned' | 'active' | 'parked' | 'inactive' | 'archived'

export interface SidebarPreferences {
  autoArchiveEnabled: boolean
  idleMinutes: number
  scanIntervalMinutes: number
  excludedWorkspaceIds: string[]
  excludedSessionIds: string[]
  parkedSessionIds: string[]
  collapsedSections: SidebarSection[]
  workspaceFilter: string | null
  headerMode: 'compact' | 'expanded'
  headerOrder: string[]
  hiddenHeaderIds: string[]
  footerOrder: string[]
  hiddenFooterIds: string[]
}

export const DEFAULT_PREFERENCES: SidebarPreferences = {
  autoArchiveEnabled: false,
  idleMinutes: 120,
  scanIntervalMinutes: 10,
  excludedWorkspaceIds: [],
  excludedSessionIds: [],
  parkedSessionIds: [],
  collapsedSections: [],
  workspaceFilter: null,
  headerMode: 'compact',
  headerOrder: [],
  hiddenHeaderIds: [],
  footerOrder: [],
  hiddenFooterIds: [],
}

export interface OrderedSidebarEntry {
  id: string
  order: number
}

export type SessionActivity = Pick<SessionSummary, 'id' | 'running' | 'updatedAt' | 'blank'>

export interface AutoArchiveContext {
  session: SessionActivity
  workspaceId: string | undefined
  now: number
  preferences: SidebarPreferences
  archivedSessionIds: ReadonlySet<string>
  pinnedSessionIds: ReadonlySet<string>
}

export const parseSessionIds = (value: string): string[] =>
  [...new Set(value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))]

export const orderSidebarEntries = <Entry extends OrderedSidebarEntry>(
  entries: readonly Entry[],
  savedOrder: readonly string[],
): Entry[] => {
  const savedPositions = new Map(savedOrder.map((id, index) => [id, index]))
  return entries
    .map((entry, index) => ({ entry, index, savedPosition: savedPositions.get(entry.id) }))
    .sort((left, right) => {
      if (left.savedPosition !== undefined && right.savedPosition !== undefined) {
        return left.savedPosition - right.savedPosition || left.index - right.index
      }
      if (left.savedPosition !== undefined) return -1
      if (right.savedPosition !== undefined) return 1
      return left.entry.order - right.entry.order || left.index - right.index
    })
    .map(({ entry }) => entry)
}

export const moveSidebarEntry = (
  orderedIds: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] => {
  const next = [...orderedIds]
  const index = next.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return next
  const displaced = next[target]
  if (displaced === undefined) return next
  next[target] = id
  next[index] = displaced
  return next
}

export const archiveWithoutStopping = <SessionId extends string>(
  archive: (sessionId: SessionId, options: { readonly stopActivity: false }) => Promise<void>,
  sessionId: SessionId,
): Promise<void> => archive(sessionId, { stopActivity: false })

export const isAutoArchiveCandidate = ({
  session,
  workspaceId,
  now,
  preferences,
  archivedSessionIds,
  pinnedSessionIds,
}: AutoArchiveContext): boolean => {
  if (!preferences.autoArchiveEnabled || session.running || session.blank) return false
  if (archivedSessionIds.has(session.id) || pinnedSessionIds.has(session.id)) return false
  if (preferences.parkedSessionIds.includes(session.id)) return false
  if (preferences.excludedSessionIds.includes(session.id)) return false
  if (workspaceId !== undefined && preferences.excludedWorkspaceIds.includes(workspaceId)) return false
  if (!Number.isFinite(session.updatedAt) || session.updatedAt > now) return false

  return now - session.updatedAt >= preferences.idleMinutes * 60_000
}

export const sectionForSession = (
  session: Pick<SessionSummary, 'id' | 'running'>,
  archivedSessionIds: ReadonlySet<string>,
  pinnedSessionIds: ReadonlySet<string>,
  parkedSessionIds: ReadonlySet<string>,
): SidebarSection => {
  if (archivedSessionIds.has(session.id)) return 'archived'
  if (pinnedSessionIds.has(session.id)) return 'pinned'
  if (session.running) return 'active'
  if (parkedSessionIds.has(session.id)) return 'parked'
  return 'inactive'
}
