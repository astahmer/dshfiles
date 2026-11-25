import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

type InputNeededSession = Pick<SessionSummary, 'id' | 'blank' | 'updatedAt'>
type TurnFinishedSession = Pick<SessionSummary, 'id' | 'blank' | 'running' | 'updatedAt'>

export const selectTurnFinishedRows = <Session extends TurnFinishedSession>(options: {
  readonly sessions: readonly Session[]
  readonly selectedSessionId: Session['id'] | undefined
  readonly inputNeededSessionIds: ReadonlySet<Session['id']>
  readonly approvalNeededSessionIds: ReadonlySet<Session['id']>
  readonly completionAt: Readonly<Record<string, number>>
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  /** Threads a sibling group already lists, so one thread never claims two groups. */
  readonly excludedSessionIds: ReadonlySet<Session['id']>
  readonly matchesWorkspace: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(
      session =>
        !session.running &&
        !session.blank &&
        session.id !== options.selectedSessionId &&
        !options.inputNeededSessionIds.has(session.id) &&
        !options.approvalNeededSessionIds.has(session.id) &&
        !options.excludedSessionIds.has(session.id) &&
        options.completionAt[session.id] !== undefined &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        !options.settledSessionIds.has(session.id) &&
        options.matchesWorkspace(session),
    )
    .sort((left, right) => (options.completionAt[right.id] ?? 0) - (options.completionAt[left.id] ?? 0))

export const selectInputNeededRows = <Session extends InputNeededSession>(options: {
  readonly sessions: readonly Session[]
  readonly pendingInteractionKindFor: (sessionId: Session['id']) => string | undefined
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(
      session =>
        !session.blank &&
        options.pendingInteractionKindFor(session.id) === 'question' &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        !options.settledSessionIds.has(session.id) &&
        options.matchesWorkspace(session),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)

/**
 * Threads waiting on a tool approval or a plan review: Needs you on every surface, the open thread included, so the
 * list, the tab, the header and the browser title agree while it waits (DESIGN.md, "Waiting on you is Needs you").
 */
export const selectApprovalNeededRows = <Session extends InputNeededSession>(options: {
  readonly sessions: readonly Session[]
  readonly pendingInteractionKindFor: (sessionId: Session['id']) => string | undefined
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(session => {
      const kind = options.pendingInteractionKindFor(session.id)
      return (
        !session.blank &&
        (kind === 'approval' || kind === 'plan-review') &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        !options.settledSessionIds.has(session.id) &&
        options.matchesWorkspace(session)
      )
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
