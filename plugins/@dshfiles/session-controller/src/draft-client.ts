import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** Presentation metadata only. The composer owns the complete text and attachments. */
export interface SessionDraft {
  readonly sessionId: SessionId
  readonly workspaceId?: WorkspaceId
  readonly preview: string
  /** True until Host creation and staged choices have both settled. */
  readonly local: boolean
  readonly model?: ModelSelection
  readonly agentPreset?: string
}

/** A locally addressable blank; settled resolves only after the first content creates it on the Host. */
export interface SessionCreateHandle {
  readonly sessionId: SessionId
  readonly settled: Promise<SessionId>
}

/** Client-owned unsent conversation lifecycle, independent of Host blank presentation. */
export interface SessionDrafts {
  readonly list: ObservableSnapshot<Readonly<Record<string, SessionDraft>>>
  create(opts: { workspaceId: WorkspaceId; cwd: string; agentPreset?: string }): SessionCreateHandle
  update(sessionId: SessionId, content: { text: string; hasAttachments: boolean }): void
  /** True consumes a choice locally; false delegates to the existing Host mutation path. */
  stageModel(sessionId: SessionId, selection: ModelSelection): boolean
  stagePreset(sessionId: SessionId, agentPreset: string): boolean
  /** Does not activate an empty draft. Rejects a failed attempt; cancellation affects this waiter only. */
  whenCreated(sessionId: SessionId, signal?: AbortSignal): Promise<void>
  /** Explicit retry of a failed creation; never creates an empty draft. Sending again also retries. */
  retry(sessionId: SessionId): Promise<SessionId>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionDrafts: SessionDrafts
  }
}

// The owned controller's added method belongs to this canonical boundary, not to each consumer.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface ISessions {
    createOptimistic(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId; agentPreset?: string }): SessionCreateHandle
  }
}
