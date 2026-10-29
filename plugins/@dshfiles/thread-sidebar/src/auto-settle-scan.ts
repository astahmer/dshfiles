import { SidebarOrganization, type AutoSettlePolicy } from './organization.js'
import { indexRebasedThreadSessions, type RebasedThread } from './rebased-threads.js'
import { threadDelayMs } from './thread-delays.js'

/** What the Host knows about one Session when it scans; `pendingInteraction` is an answerable question. */
export interface ScannedSession {
  readonly id: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
  readonly parentId?: string | undefined
  readonly pendingInteraction: boolean
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
}

export interface AutoSettleDecision {
  /** Threads idle past the threshold under the global or per-thread policy. */
  readonly idle: readonly string[]
  /** Threads whose jj workspace was rebased and stayed quiet through the configured delay. */
  readonly rebased: readonly string[]
}

const scansIdle = (policy: AutoSettlePolicy): boolean => SidebarOrganization.shouldScanForAutoSettle(policy)

const scansRebased = (policy: AutoSettlePolicy): boolean => policy.rebasedThreadSettleDelay !== 'disabled'

/** Whether any trigger the scan owns is switched on; when none is, the scan reads nothing. */
const isActive = (policy: AutoSettlePolicy): boolean => scansIdle(policy) || scansRebased(policy)

/** Which threads one scan settles: the same idle and rebased rules the sidebar applied in the browser. */
const decide = (input: AutoSettleScanInput): AutoSettleDecision => {
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
      if (!isCandidate || session.pendingInteraction || SidebarOrganization.hasRunningDescendant({ sessionId: session.id, sessions: input.sessions })) continue
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
      if (idleIds.has(sessionId) || SidebarOrganization.hasRunningDescendant({ sessionId, sessions: input.sessions })) continue
      rebased.push(sessionId)
    }
  }

  return { idle, rebased }
}

export type SettleRequestSkip = 'unknown' | 'running' | 'running-descendant' | 'pending-question' | 'blank' | 'archived' | 'pinned' | 'opted-out'

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
  if (SidebarOrganization.hasRunningDescendant({ sessionId: session.id, sessions: input.sessions })) return 'running-descendant'
  return 'settle'
}

export class AutoSettleScanModel {
  static readonly decide = decide
  static readonly isActive = isActive
  static readonly requestOutcome = requestOutcome
}
