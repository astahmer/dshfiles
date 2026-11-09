import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'

interface IndexedSession {
  readonly running?: boolean | undefined
  readonly cwd?: string | undefined
  readonly projectionValues?: Parameters<typeof ThreadRebaseEligibilityModel.hasPendingUserQuestion>[0]
}

type SessionsById = Readonly<Record<string, IndexedSession | undefined>>

interface WorkspaceActivity {
  running: boolean
  question: boolean
}

interface WorkspaceQuery {
  readonly byId: SessionsById
  readonly sessionIds: readonly string[]
  readonly path: string | undefined
}

/**
 * Running and pending-question state per workspace folder, folded once per Session-list snapshot. Every mounted
 * conversation reads it on each list change, so a per-reader scan of the whole list would cost O(sessions × views).
 */
export class WorkspaceActivityIndex {
  private static readonly byCwdBySnapshot = new WeakMap<SessionsById, ReadonlyMap<string, WorkspaceActivity>>()

  static byCwd(byId: SessionsById): ReadonlyMap<string, WorkspaceActivity> {
    const cached = WorkspaceActivityIndex.byCwdBySnapshot.get(byId)
    if (cached !== undefined) return cached
    const byCwd = new Map<string, WorkspaceActivity>()
    for (const session of Object.values(byId)) {
      if (session?.cwd === undefined) continue
      const running = session.running === true
      const question = ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) === true
      if (!running && !question) continue
      const activity = byCwd.get(session.cwd)
      if (activity === undefined) {
        byCwd.set(session.cwd, { running, question })
        continue
      }
      activity.running ||= running
      activity.question ||= question
    }
    WorkspaceActivityIndex.byCwdBySnapshot.set(byId, byCwd)
    return byCwd
  }

  static isRunning(query: WorkspaceQuery): boolean {
    if (query.sessionIds.some(sessionId => query.byId[sessionId]?.running === true)) return true
    return query.path !== undefined && WorkspaceActivityIndex.byCwd(query.byId).get(query.path)?.running === true
  }

  static hasQuestion(query: WorkspaceQuery): boolean {
    const asks = (session: IndexedSession | undefined): boolean => ThreadRebaseEligibilityModel.hasPendingUserQuestion(session?.projectionValues) === true
    if (query.sessionIds.some(sessionId => asks(query.byId[sessionId]))) return true
    return query.path !== undefined && WorkspaceActivityIndex.byCwd(query.byId).get(query.path)?.question === true
  }
}
