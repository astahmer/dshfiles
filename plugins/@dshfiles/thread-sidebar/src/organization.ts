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
  // Everything in the sidebar's working set starts open: pinned, active and
  // inactive are where a thread is found and acted on, and parked keeps its short
  // rows in view. Archived is storage, so it starts folded until asked for.
  collapsedSections: ['archived'],
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

export interface SessionLineage {
  /** Number of known direct-parent edges above the session. */
  depth: number
  /** Durable direct parent identity, when the session is a child. */
  parentId?: SessionSummary['id']
  /** Current parent title, falling back to its durable identity. */
  parentTitle?: string
}

/**
 * Project a Session's direct parent and visual depth from the durable parentId
 * chain. A visited set keeps corrupt cycles bounded; missing ancestors still
 * preserve the direct relationship and one level of indentation.
 */
export const sessionLineage = (session: Pick<SessionSummary, 'id' | 'parentId'>, byId: Readonly<Record<string, SessionSummary>>): SessionLineage => {
  if (session.parentId === undefined) return { depth: 0 }

  let depth = 0
  let cursor: string | undefined = session.parentId
  const visited = new Set<string>([session.id])
  const directParent = byId[session.parentId]
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    depth += 1
    cursor = byId[cursor]?.parentId
  }

  return {
    depth,
    parentId: session.parentId,
    parentTitle: directParent?.displayTitle ?? session.parentId,
  }
}

/** Resolve a workspace from the session or its nearest known ancestor. */
export const workspaceForLineage = (
  session: Pick<SessionSummary, 'id' | 'parentId'>,
  byId: Readonly<Record<string, SessionSummary>>,
  workspaceBySession: ReadonlyMap<string, string>,
): string | undefined => {
  let cursor: string | undefined = session.id
  const visited = new Set<string>()
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const workspaceId = workspaceBySession.get(cursor)
    if (workspaceId !== undefined) return workspaceId
    cursor = byId[cursor]?.parentId
  }
  return undefined
}

export const parseSessionIds = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map(item => item.trim())
      .filter(Boolean),
  ),
]

export const orderSidebarEntries = <Entry extends OrderedSidebarEntry>(entries: readonly Entry[], savedOrder: readonly string[]): Entry[] => {
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

export const moveSidebarEntry = (orderedIds: readonly string[], id: string, direction: -1 | 1): string[] => {
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

/**
 * Reorder by drop index, the shape a pointer drag produces.
 *
 * `fromIndex` is read against the list before the move, so removing the dragged
 * entry first and then inserting at the target index would skip a slot whenever
 * the target sits after the source. An out-of-range or unknown source leaves the
 * order untouched rather than dropping an unrelated entry.
 */
export const reorderSidebarEntry = (orderedIds: readonly string[], fromIndex: number, toIndex: number): string[] => {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return [...orderedIds]
  if (fromIndex < 0 || fromIndex >= orderedIds.length) return [...orderedIds]
  if (toIndex < 0 || toIndex >= orderedIds.length) return [...orderedIds]
  if (fromIndex === toIndex) return [...orderedIds]
  const next = [...orderedIds]
  const [moved] = next.splice(fromIndex, 1)
  if (moved === undefined) return [...orderedIds]
  next.splice(toIndex, 0, moved)
  return next
}

export const archiveWithoutStopping = <SessionId extends string>(
  archive: (sessionId: SessionId, options: { readonly stopActivity: false }) => Promise<void>,
  sessionId: SessionId,
): Promise<void> => archive(sessionId, { stopActivity: false })

export const isAutoArchiveCandidate = ({ session, workspaceId, now, preferences, archivedSessionIds, pinnedSessionIds }: AutoArchiveContext): boolean => {
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
