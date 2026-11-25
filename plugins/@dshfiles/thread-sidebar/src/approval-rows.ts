import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

type ApprovalSession = Pick<SessionSummary, 'id' | 'blank' | 'updatedAt'>

/**
 * Threads waiting on a tool approval or a plan review: Needs you on every surface, the open thread included, so the
 * list, the tab, the header and the browser title agree while it waits (DESIGN.md, "Waiting on you is Needs you").
 */
const select = <Session extends ApprovalSession>(options: {
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

export class ApprovalRows {
  static readonly select = select
}
