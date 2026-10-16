type RecoveryRow = { readonly id: string; readonly blank: boolean; readonly running: boolean; readonly updatedAt: number }

export const selectRestartRecoveryRows = <Session extends RecoveryRow>(options: {
  readonly sessions: readonly Session[]
  readonly sessionIds: ReadonlySet<string>
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
  readonly matchesSource: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(
      session =>
        options.sessionIds.has(session.id) &&
        !session.blank &&
        !session.running &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        options.matchesWorkspace(session) &&
        options.matchesSource(session),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
