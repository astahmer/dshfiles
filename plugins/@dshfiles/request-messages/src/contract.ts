import type {} from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Message, ToolHistory } from '@deepseek-ai/dsh-llm'
import type { Scoped } from '@deepseek-ai/dsh-scope'

export interface RequestMessagesPayload {
  readonly agent: Agent
  readonly turn: number
  readonly step: number
  readonly isFirstStepOfTurn: boolean
  /** The messages DSH derived for this request, frozen. */
  readonly messages: readonly Message[]
  readonly toolHistory: ToolHistory
  readonly signal: AbortSignal
}

export type RequestMessagesStatus = { readonly active: true } | { readonly active: false; readonly reason: string }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Replace the messages one agent-loop model request sends, without touching the session log.
     * `await next()` yields the messages the previous listeners settled on; return a different
     * list to send it instead. Config, tools and tool history stay as DSH built them.
     */
    'agent/request-messages'(this: Scoped<Agent>, payload: RequestMessagesPayload, next: () => Promise<readonly Message[]>): Promise<readonly Message[]>
    /** Answered by `@dshfiles/request-messages`; no answer means the event is never dispatched. */
    'request-messages/status'(): RequestMessagesStatus | undefined
  }
}
