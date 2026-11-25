import { SidebarOrganization, type AutoSettlePolicy } from './organization.js'
import { indexRebasedThreadSessions, type RebasedThread } from './rebased-threads.js'
import type { ScannedReminder } from './reminder-wake.js'
import { threadDelayMs } from './thread-delays.js'

/** What the Host knows about one Session when it scans; `pendingInteraction` is an answerable question. */
export interface ScannedSession {
  readonly id: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
  readonly parentId?: string | undefined
  readonly pendingInteraction: boolean
  /** At least one background job started by this Session still runs or stops. */
  readonly workingJobs: boolean
}

export interface AutoSettleScanInput {
  readonly now: number
  readonly policy: AutoSettlePolicy
  readonly sessions: readonly ScannedSession[]
  readonly workspaceBySession: ReadonlyMap<string, string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  /** jj-integration's thread workspaces; undefined when it is absent, so rebased settling is skipped. */
  readonly rebasedThreads: readonly RebasedThread[] | undefined
  /** Active reminders per target Session; a thread holding one is never settled, however far out it is. */
  readonly reminders: readonly ScannedReminder[]
  /** Threads whose turn a restart or a crash cut off: a resume must still be able to reach them. */
  readonly interruptedSessionIds: ReadonlySet<string>
}

export interface AutoSettleDecision {
  /** Threads idle past the threshold under the global or per-thread policy. */
  readonly idle: readonly string[]
  /** Threads whose jj workspace was rebased and stayed quiet through the configured delay. */
  readonly rebased: readonly string[]
  /** Subagent threads idle past `subagentSettleHours`; their running jobs are stopped with the settle. */
  readonly subagents: readonly string[]
}

const scansIdle = (policy: AutoSettlePolicy): boolean => SidebarOrganization.shouldScanForAutoSettle(policy)

const scansRebased = (policy: AutoSettlePolicy): boolean => policy.rebasedThreadSettleDelay !== 'disabled'

const scansSubagents = (policy: AutoSettlePolicy): boolean => policy.subagentSettleHours > 0

/** Whether any trigger the scan owns is switched on; when none is, the scan reads nothing. */
const isActive = (policy: AutoSettlePolicy): boolean => scansIdle(policy) || scansRebased(policy) || scansSubagents(policy)

const HOUR_MS = 60 * 60_000

/** A turn, a pending answer or a background job: work that settling this Session would reject mid-flight. */
const works = (session: ScannedSession): boolean => !session.blank && (session.running || session.pendingInteraction || session.workingJobs)

/**
 * Whether this Session, or a Session below it, still works. Settling an ancestor rejects the next step of any
 * live descendant — a running subagent, one waiting for an answer, or one whose background job is about to
 * wake it — so the scan leaves the whole tree alone until the session settles on its own.
 */
const hasWorkingTree = (input: { readonly sessionId: string; readonly sessions: readonly ScannedSession[] }): boolean => {
  const byId = new Map(input.sessions.map(session => [session.id, session] as const))
  const children = new Map<string, ScannedSession[]>()
  for (const session of input.sessions) {
    if (session.parentId === undefined) continue
    const siblings = children.get(session.parentId)
    if (siblings === undefined) children.set(session.parentId, [session])
    else siblings.push(session)
  }
  const pending = [input.sessionId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const sessionId = pending.pop()
    if (sessionId === undefined || visited.has(sessionId)) continue
    visited.add(sessionId)
    const session = byId.get(sessionId)
    if (session !== undefined && works(session)) return true
    for (const child of children.get(sessionId) ?? []) pending.push(child.id)
  }
  return false
}

/**
 * Whether this Session or one below it is held by `held`: an active reminder will wake it, or a turn a restart cut
 * off still waits for its resume. Settling the parent would reject that step, so the whole tree stays unsettled.
 */
const heldInTree = (input: { readonly sessionId: string; readonly sessions: readonly ScannedSession[]; readonly held: ReadonlySet<string> }): boolean => {
  if (input.held.size === 0) return false
  const held = input.held
  const children = new Map<string, string[]>()
  for (const session of input.sessions) {
    if (session.parentId === undefined) continue
    const siblings = children.get(session.parentId)
    if (siblings === undefined) children.set(session.parentId, [session.id])
    else siblings.push(session.id)
  }
  const pending = [input.sessionId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const sessionId = pending.pop()
    if (sessionId === undefined || visited.has(sessionId)) continue
    visited.add(sessionId)
    if (held.has(sessionId)) return true
    for (const child of children.get(sessionId) ?? []) pending.push(child)
  }
  return false
}

/** The holds one scan reads: an active reminder target per Session, and a thread waiting for its resume. */
const holdsOf = (input: AutoSettleScanInput): ReadonlySet<string> =>
  new Set([...input.reminders.filter(reminder => reminder.active).map(reminder => reminder.sessionId), ...input.interruptedSessionIds])

/** Which threads one scan settles: the same idle and rebased rules the sidebar applied in the browser. */
const decide = (input: AutoSettleScanInput): AutoSettleDecision => {
  const holds = holdsOf(input)
  const idle: string[] = []
  if (scansIdle(input.policy)) {
    for (const session of input.sessions) {
      const isCandidate = SidebarOrganization.isAutoSettleCandidate({
        session,
        workspaceId: input.workspaceBySession.get(session.id),
        now: input.now,
        preferences: input.policy,
        archivedSessionIds: input.archivedSessionIds,
        pinnedSessionIds: input.pinnedSessionIds,
        settledSessionIds: input.settledSessionIds,
      })
      if (!isCandidate) continue
      if (hasWorkingTree({ sessionId: session.id, sessions: input.sessions })) continue
      if (heldInTree({ sessionId: session.id, sessions: input.sessions, held: holds })) continue
      idle.push(session.id)
    }
  }

  const rebased: string[] = []
  if (scansRebased(input.policy) && input.rebasedThreads !== undefined) {
    const index = indexRebasedThreadSessions({
      threads: input.rebasedThreads,
      sessions: new Map(input.sessions.map(session => [session.id, session])),
      archivedSessionIds: input.archivedSessionIds,
      pinnedSessionIds: input.pinnedSessionIds,
      settledSessionIds: input.settledSessionIds,
      now: input.now,
      delayMs: threadDelayMs(input.policy.rebasedThreadSettleDelay),
    })
    const idleIds = new Set(idle)
    for (const sessionId of index.dueSessionIds) {
      if (idleIds.has(sessionId)) continue
      if (hasWorkingTree({ sessionId, sessions: input.sessions })) continue
      if (heldInTree({ sessionId, sessions: input.sessions, held: holds })) continue
      rebased.push(sessionId)
    }
  }

  const subagents: string[] = []
  if (scansSubagents(input.policy)) {
    const taken = new Set([...idle, ...rebased])
    for (const session of input.sessions) {
      if (session.parentId === undefined || taken.has(session.id)) continue
      if (!Number.isFinite(session.updatedAt) || input.now - session.updatedAt < input.policy.subagentSettleHours * HOUR_MS) continue
      if (requestOutcome({ ...input, sessionId: session.id }) !== 'settle') continue
      if (input.policy.parkedSessionIds.includes(session.id) || input.policy.excludedSessionIds.includes(session.id)) continue
      subagents.push(session.id)
    }
  }

  return { idle, rebased, subagents }
}

export type SettleRequestSkip =
  | 'unknown'
  | 'running'
  | 'running-descendant'
  | 'pending-question'
  | 'blank'
  | 'archived'
  | 'pinned'
  | 'opted-out'
  | 'reminder'
  | 'interrupted'

/**
 * Whether a trigger another plugin raised may settle one thread. Triggers are automatic, so they keep the
 * scan's safety rules: a thread that works, waits for an answer, is pinned or opted out of auto-settle stays.
 */
const requestOutcome = (input: {
  readonly sessionId: string
  readonly sessions: readonly ScannedSession[]
  readonly policy: Pick<AutoSettlePolicy, 'autoSettleDisabledSessionIds'>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly reminders?: readonly ScannedReminder[] | undefined
  readonly interruptedSessionIds?: ReadonlySet<string> | undefined
}): 'settle' | 'already-settled' | SettleRequestSkip => {
  if (input.settledSessionIds.has(input.sessionId)) return 'already-settled'
  const session = input.sessions.find(candidate => candidate.id === input.sessionId)
  if (session === undefined) return 'unknown'
  if (session.running) return 'running'
  if (session.blank) return 'blank'
  if (session.pendingInteraction) return 'pending-question'
  if (input.archivedSessionIds.has(session.id)) return 'archived'
  if (input.pinnedSessionIds.has(session.id)) return 'pinned'
  if (input.policy.autoSettleDisabledSessionIds.includes(session.id)) return 'opted-out'
  if (hasWorkingTree({ sessionId: session.id, sessions: input.sessions })) return 'running-descendant'
  const reminders = input.reminders ?? []
  if (input.interruptedSessionIds?.has(session.id) === true) return 'interrupted'
  if (
    heldInTree({
      sessionId: session.id,
      sessions: input.sessions,
      held: new Set(reminders.filter(reminder => reminder.active).map(reminder => reminder.sessionId)),
    })
  )
    return 'reminder'
  return 'settle'
}

export class AutoSettleScanModel {
  static readonly decide = decide
  static readonly isActive = isActive
  static readonly requestOutcome = requestOutcome
}
