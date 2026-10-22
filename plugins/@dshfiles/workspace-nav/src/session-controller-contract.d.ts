/**
 * `@dshfiles/session-controller` forks the native controller and adds
 * optimistic creation (`createOptimistic`). The native package's client types
 * still describe the waiting `create`; augment the one interface this fork
 * calls rather than restating the controller contract.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    workspaceOperation: unknown
  }

  /** Provisional creation handle returned by the fork's `createOptimistic`. */
  interface SessionCreateHandle {
    /** Identity the caller may navigate to and retain before the Host answers. */
    readonly sessionId: SessionId
    /** Final identity once the Host answers; rejects after removing the provisional row. */
    readonly settled: Promise<SessionId>
  }

  interface ISessions {
    /** Create a Session whose blank row is addressable before the Host answers. */
    createOptimistic(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId; agentPreset?: string }): SessionCreateHandle
  }
}
