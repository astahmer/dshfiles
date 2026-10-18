import type { RecoveryReason } from './restart-recovery.js'

type RecoveryRow = { readonly id: string; readonly blank: boolean; readonly running: boolean; readonly updatedAt: number }

/** Recovery rows of one reason that are still idle and visible, newest first. */
export const selectRecoveryRows = <Session extends RecoveryRow>(options: {
  readonly sessions: readonly Session[]
  readonly sessionIds: ReadonlySet<string>
  readonly reason: RecoveryReason
  readonly reasonFor: (sessionId: string) => RecoveryReason | undefined
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
  readonly matchesSource: (session: Session) => boolean
}): Session[] =>
  options.sessions
    .filter(
      session =>
        options.sessionIds.has(session.id) &&
        options.reasonFor(session.id) === options.reason &&
        !session.blank &&
        !session.running &&
        !options.mutedSessionIds.has(session.id) &&
        !options.archivedSessionIds.has(session.id) &&
        !options.settledSessionIds.has(session.id) &&
        options.matchesWorkspace(session) &&
        options.matchesSource(session),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)

/** Managed-restart rows; ids without a recorded reason count as restarts. */
export const selectRestartRecoveryRows = <Session extends RecoveryRow>(options: {
  readonly sessions: readonly Session[]
  readonly sessionIds: ReadonlySet<string>
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
  readonly matchesSource: (session: Session) => boolean
  readonly reasonFor?: (sessionId: string) => RecoveryReason | undefined
}): Session[] =>
  selectRecoveryRows({
    ...options,
    reason: 'restart',
    reasonFor: options.reasonFor ?? (() => 'restart'),
  })
