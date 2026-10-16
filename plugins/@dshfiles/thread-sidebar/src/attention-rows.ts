import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

type InputNeededSession = Pick<SessionSummary, 'id' | 'blank' | 'updatedAt'>

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
