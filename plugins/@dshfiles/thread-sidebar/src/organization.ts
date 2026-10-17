import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { z } from 'zod'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { FinishedSubagentsMode } from './thread-children.js'
import type { ThreadMutes } from './thread-mute.js'
import { DEFAULT_THREAD_NOTIFICATION_CATEGORIES, type ThreadNotificationCategories } from './thread-notifications.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, type ThreadViewSettings } from './thread-view-preferences.js'

export type SidebarSection = 'pinned' | 'active' | 'parked' | 'inactive' | 'archived'

export const SIDEBAR_HEADER_MIN_HEIGHT = 44
export const SIDEBAR_THREAD_MIN_HEIGHT = 120
export const SIDEBAR_SPLITTER_HEIGHT = 12
/** At or below this navigation height the labelled list folds into BB's horizontal icon row. */
export const SIDEBAR_ICON_ROW_THRESHOLD = 76

export type NavigationDensity = 'compact' | 'comfortable'
export type NavigationOverflow = 'scroll' | 'menu' | 'scroll-menu'
export type AttentionDisplayMode = 'group' | 'label'
export const ATTENTION_COLOR_OPTIONS = ['muted', 'primary', 'info', 'success', 'warning', 'danger'] as const
export type AttentionColor = (typeof ATTENTION_COLOR_OPTIONS)[number]
export type AttentionColorKey = 'approvalNeeded' | 'inputNeeded' | 'turnFinished'
export type AttentionColors = Record<AttentionColorKey, AttentionColor>
export const REBASED_THREAD_ARCHIVE_DELAYS = ['disabled', 'immediately', 'after-1-hour', 'after-1-day', 'after-1-week'] as const
export type RebasedThreadArchiveDelay = (typeof REBASED_THREAD_ARCHIVE_DELAYS)[number]

export interface SidebarPreferences {
  archiveUndoEnabled: boolean
  archiveUndoDurationSeconds: number
  autoArchiveEnabled: boolean
  rebasedThreadArchiveDelay: RebasedThreadArchiveDelay
  idleMinutes: number
  scanIntervalMinutes: number
  excludedWorkspaceIds: string[]
  excludedSessionIds: string[]
  autoArchiveSessionIds: string[]
  autoArchiveDisabledSessionIds: string[]
  parkedSessionIds: string[]
  /** Muted or snoozed threads by session id; Host-synced so every browser stays quiet. */
  mutedThreads: ThreadMutes
  collapsedSections: SidebarSection[]
  workspaceFilter: string | null
  headerMode: 'compact' | 'expanded'
  /** Drop the Host brand mark and name from the header; the collapse button stays. */
  hideBrandLogo: boolean
  headerRegionHeight: number | null
  headerOrder: string[]
  hiddenHeaderIds: string[]
  footerOrder: string[]
  hiddenFooterIds: string[]
  navigationDensity: NavigationDensity
  navigationOverflow: NavigationOverflow
  /** Capture-phase chords in `primary+shift+KeyP` form; null disables the chord. */
  paletteChord: string | null
  fileSearchChord: string | null
  threadSearchChord: string | null
  backChord: string | null
  forwardChord: string | null
  paletteRecentLimit: number
  threadRowDensity: ThreadRowDensity
  threadRowProject: boolean
  threadRowProjectColor: boolean
  threadRowTitle: boolean
  threadRowMachine: boolean
  threadRowPath: boolean
  threadRowTime: boolean
  threadRowStatusDot: boolean
  approvalNeededDisplay: AttentionDisplayMode
  inputNeededDisplay: AttentionDisplayMode
  turnFinishedDisplay: AttentionDisplayMode
  attentionColors: AttentionColors
  includeSubagentAttention: boolean
  /** Kept only to migrate older Host/browser settings into per-category routes. */
  desktopNotificationsEnabled: boolean
  notificationCategories: ThreadNotificationCategories
  applyActionsToChildThreads: boolean
  /** Child threads listed under a parent before the "N more…" line. */
  maxChildren: number
  finishedSubagents: FinishedSubagentsMode
  /** Saved thread views and the controls around them; Host-synced so every browser reads the same set. */
  threadViews: ThreadViewSettings
}

export type ThreadRowDensity = 'compact' | 'comfortable'

export const DEFAULT_PREFERENCES: SidebarPreferences = {
  archiveUndoEnabled: true,
  archiveUndoDurationSeconds: 5,
  autoArchiveEnabled: false,
  rebasedThreadArchiveDelay: 'disabled',
  idleMinutes: 120,
  scanIntervalMinutes: 10,
  excludedWorkspaceIds: [],
  excludedSessionIds: [],
  autoArchiveSessionIds: [],
  autoArchiveDisabledSessionIds: [],
  parkedSessionIds: [],
  mutedThreads: {},
  // Keep every working section open; archived threads stay folded until requested.
  collapsedSections: ['archived'],
  workspaceFilter: null,
  headerMode: 'compact',
  hideBrandLogo: false,
  headerRegionHeight: null,
  headerOrder: [],
  hiddenHeaderIds: [],
  footerOrder: [],
  hiddenFooterIds: [],
  navigationDensity: 'compact',
  navigationOverflow: 'scroll-menu',
  paletteChord: 'primary+KeyK',
  fileSearchChord: 'primary+KeyP',
  // Thread search stays on the Host's session.search (⌥⌘K) and in ⌘K; ⌘P opens files.
  threadSearchChord: null,
  backChord: 'primary+BracketLeft',
  forwardChord: 'primary+BracketRight',
  paletteRecentLimit: 20,
  threadRowDensity: 'compact',
  threadRowProject: true,
  threadRowProjectColor: true,
  threadRowTitle: true,
  threadRowMachine: true,
  threadRowPath: false,
  threadRowTime: true,
  threadRowStatusDot: true,
  approvalNeededDisplay: 'group',
  inputNeededDisplay: 'group',
  turnFinishedDisplay: 'label',
  attentionColors: { approvalNeeded: 'warning', inputNeeded: 'warning', turnFinished: 'success' },
  includeSubagentAttention: false,
  desktopNotificationsEnabled: false,
  notificationCategories: DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
  applyActionsToChildThreads: true,
  maxChildren: 3,
  finishedSubagents: 'collapse',
  threadViews: DEFAULT_THREAD_VIEW_SETTINGS,
}

export interface OrderedSidebarEntry {
  id: string
  order: number
}

export type SessionActivity = Pick<SessionSummary, 'id' | 'running' | 'updatedAt' | 'blank'>

export const isAttentionSessionIncluded = (session: Pick<SessionSummary, 'origin' | 'parentId'>, includeSubagentAttention: boolean): boolean =>
  includeSubagentAttention || (session.origin !== 'subagent' && session.parentId === undefined)

export interface AutoArchiveContext {
  session: SessionActivity
  workspaceId: string | undefined
  now: number
  preferences: SidebarPreferences
  archivedSessionIds: ReadonlySet<string>
  pinnedSessionIds: ReadonlySet<string>
}

export type AutoArchiveOverride = 'inherit' | 'enabled' | 'disabled'

export const autoArchiveOverrideForSession = (preferences: SidebarPreferences, sessionId: string): AutoArchiveOverride => {
  if (preferences.autoArchiveDisabledSessionIds.includes(sessionId)) return 'disabled'
  if (preferences.autoArchiveSessionIds.includes(sessionId)) return 'enabled'
  return 'inherit'
}

export const setAutoArchiveOverride = (preferences: SidebarPreferences, sessionId: string, override: AutoArchiveOverride): SidebarPreferences => ({
  ...preferences,
  autoArchiveSessionIds:
    override === 'enabled' ? [...new Set([...preferences.autoArchiveSessionIds, sessionId])] : preferences.autoArchiveSessionIds.filter(id => id !== sessionId),
  autoArchiveDisabledSessionIds:
    override === 'disabled'
      ? [...new Set([...preferences.autoArchiveDisabledSessionIds, sessionId])]
      : preferences.autoArchiveDisabledSessionIds.filter(id => id !== sessionId),
})

export const shouldScanForAutoArchive = (preferences: SidebarPreferences): boolean =>
  preferences.autoArchiveEnabled || preferences.autoArchiveSessionIds.length > 0

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

const THREADS_DIRECTORY_SUFFIX = '-threads'

const projectOfThreadWorkspace = (workspace: WorkspaceView, byPath: ReadonlyMap<string, WorkspaceView>): WorkspaceView | undefined => {
  const parent = workspace.path.slice(0, workspace.path.lastIndexOf('/'))
  return parent.endsWith(THREADS_DIRECTORY_SUFFIX) ? byPath.get(parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)) : undefined
}

/** jj-integration's thread workspaces are attributed to their owning project workspace. */
export const workspaceForSessions = (workspaces: readonly WorkspaceView[]): Map<string, string> => {
  const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
  const map = new Map<string, string>()
  for (const workspace of workspaces) {
    const owner = projectOfThreadWorkspace(workspace, byPath) ?? workspace
    for (const sessionId of workspace.sessionIds) map.set(sessionId, owner.workspaceId)
  }
  return map
}

export const projectWorkspaces = (workspaces: readonly WorkspaceView[]): readonly WorkspaceView[] => {
  const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
  return workspaces.filter(workspace => projectOfThreadWorkspace(workspace, byPath) === undefined)
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

const orderSidebarEntries = <Entry extends OrderedSidebarEntry>(entries: readonly Entry[], savedOrder: readonly string[]): Entry[] => {
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

const moveSidebarEntry = (orderedIds: readonly string[], id: string, direction: -1 | 1): string[] => {
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
const reorderSidebarEntry = (orderedIds: readonly string[], fromIndex: number, toIndex: number): string[] => {
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

/**
 * Reorder among the shown entries while hidden ones keep their saved slots: the
 * dragged entry lands where the shown entry it was dropped on sits in the full order.
 */
const reorderVisibleEntry = (options: {
  readonly orderedIds: readonly string[]
  readonly visibleIds: readonly string[]
  readonly fromVisible: number
  readonly toVisible: number
}): string[] => {
  const movedId = options.visibleIds[options.fromVisible]
  const targetId = options.visibleIds[options.toVisible]
  if (movedId === undefined || targetId === undefined) return [...options.orderedIds]
  return reorderSidebarEntry(options.orderedIds, options.orderedIds.indexOf(movedId), options.orderedIds.indexOf(targetId))
}

/**
 * Final index for a pointer drag along one axis: how many of the other items'
 * centres the pointer has passed.
 */
const dropIndexAt = (options: { readonly centers: readonly number[]; readonly fromIndex: number; readonly position: number }): number =>
  options.centers.filter((center, index) => index !== options.fromIndex && center < options.position).length

/** The client's WorkspaceArchiveError carries the Host refusal as `rpcError`. */
const parkedRecoveryRefusal = z.object({
  rpcError: z.object({
    code: z.literal('workspace/session-active'),
    details: z.object({ activity: z.array(z.object({ kind: z.literal('quota-continuation') })).min(1) }),
  }),
})

/**
 * Archive without stopping Host activity, except a parked quota recovery: it
 * only waits for a reset to resume the thread, and archiving means the user no
 * longer wants that, so stopping it is the archive's intent rather than a loss.
 */
const archiveWithoutStopping = async <SessionId extends string>(
  archive: (sessionId: SessionId, options: { readonly stopActivity: boolean }) => Promise<void>,
  sessionId: SessionId,
): Promise<void> => {
  try {
    await archive(sessionId, { stopActivity: false })
  } catch (error) {
    if (!parkedRecoveryRefusal.safeParse(error).success) throw error
    await archive(sessionId, { stopActivity: true })
  }
}

const hasPassedIdleThreshold = (session: Pick<SessionActivity, 'updatedAt'>, now: number, idleMinutes: number): boolean =>
  Number.isFinite(session.updatedAt) && session.updatedAt <= now && now - session.updatedAt >= idleMinutes * 60_000

export const nextIdleTransitionAt = (sessions: readonly Pick<SessionActivity, 'running' | 'updatedAt'>[], now: number, idleMinutes: number): number | null => {
  let next: number | null = null
  for (const session of sessions) {
    if (session.running || !Number.isFinite(session.updatedAt)) continue
    const inactiveAt = session.updatedAt + idleMinutes * 60_000
    if (inactiveAt > now && (next === null || inactiveAt < next)) next = inactiveAt
  }
  return next
}

export const isAutoArchiveCandidate = ({ session, workspaceId, now, preferences, archivedSessionIds, pinnedSessionIds }: AutoArchiveContext): boolean => {
  if (session.running || session.blank) return false
  if (archivedSessionIds.has(session.id) || pinnedSessionIds.has(session.id)) return false
  if (preferences.parkedSessionIds.includes(session.id)) return false
  if (preferences.excludedSessionIds.includes(session.id)) return false
  if (workspaceId !== undefined && preferences.excludedWorkspaceIds.includes(workspaceId)) return false
  const override = autoArchiveOverrideForSession(preferences, session.id)
  if (override === 'disabled') return false
  if (!preferences.autoArchiveEnabled && override !== 'enabled') return false

  return hasPassedIdleThreshold(session, now, preferences.idleMinutes)
}

export const sectionForSession = ({
  session,
  archivedSessionIds,
  pinnedSessionIds,
  parkedSessionIds,
  now,
  idleMinutes,
}: {
  readonly session: Pick<SessionSummary, 'id' | 'running' | 'updatedAt'>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly parkedSessionIds: ReadonlySet<string>
  readonly now: number
  readonly idleMinutes: number
}): SidebarSection => {
  if (archivedSessionIds.has(session.id)) return 'archived'
  if (pinnedSessionIds.has(session.id)) return 'pinned'
  if (session.running) return 'active'
  if (parkedSessionIds.has(session.id)) return 'parked'
  return hasPassedIdleThreshold(session, now, idleMinutes) ? 'inactive' : 'active'
}

/**
 * How many leading items fit in `available` pixels when a trailing control of
 * `reserve` pixels must stay visible whenever anything overflows.
 */
/**
 * Which items stay inline, in order. An item too wide for the remaining space overflows on its own,
 * so one wide third-party footer card cannot push every later entry into the More menu.
 */
const fitItems = ({ widths, available, gap, reserve }: { widths: readonly number[]; available: number; gap: number; reserve: number }): readonly boolean[] => {
  const total = widths.reduce((sum, width, index) => sum + width + (index === 0 ? 0 : gap), 0)
  if (total <= available) return widths.map(() => true)
  let used = reserve
  return widths.map(width => {
    const next = used + width + gap
    if (next > available) return false
    used = next
    return true
  })
}

export class SidebarOrganization {
  static readonly isAttentionSessionIncluded = isAttentionSessionIncluded
  static readonly autoArchiveOverrideForSession = autoArchiveOverrideForSession
  static readonly setAutoArchiveOverride = setAutoArchiveOverride
  static readonly shouldScanForAutoArchive = shouldScanForAutoArchive
  static readonly sessionLineage = sessionLineage
  static readonly workspaceForLineage = workspaceForLineage
  static readonly parseSessionIds = parseSessionIds
  static readonly orderSidebarEntries = orderSidebarEntries
  static readonly moveSidebarEntry = moveSidebarEntry
  static readonly reorderSidebarEntry = reorderSidebarEntry
  static readonly reorderVisibleEntry = reorderVisibleEntry
  static readonly dropIndexAt = dropIndexAt
  static readonly archiveWithoutStopping = archiveWithoutStopping
  static readonly nextIdleTransitionAt = nextIdleTransitionAt
  static readonly isAutoArchiveCandidate = isAutoArchiveCandidate
  static readonly sectionForSession = sectionForSession
  static readonly fitItems = fitItems
}
