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
        options.completionAt[session.id] !== undefined &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        options.matchesWorkspace(session),
    )
    .sort((left, right) => (options.completionAt[right.id] ?? 0) - (options.completionAt[left.id] ?? 0))

export const selectInputNeededRows = <Session extends InputNeededSession>(options: {
  readonly sessions: readonly Session[]
  readonly pendingInteractionKindFor: (sessionId: Session['id']) => string | undefined
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(
      session =>
        !session.blank &&
        options.pendingInteractionKindFor(session.id) === 'question' &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        options.matchesWorkspace(session),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
