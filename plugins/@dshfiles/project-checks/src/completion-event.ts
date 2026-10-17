import type {} from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface ProjectChecksVerifiedTurn {
  readonly sessionId: SessionId
  readonly turn: number
  readonly sourceRevision: string
  readonly signal: AbortSignal
  readonly requestAgentFix: (message: string) => void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Fired after every configured completion check passed against one working-copy revision.
     *
     * @mode serial
     */
    'dshfiles/project-checks/verified'(payload: ProjectChecksVerifiedTurn): void
  }
}
