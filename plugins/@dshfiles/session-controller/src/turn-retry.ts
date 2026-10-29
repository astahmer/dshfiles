import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Wakes a turn that stopped before the model replied; the chat shows it as a notice, not a human prompt. */
    'turn-retry': { readonly kind: 'turn-retry'; readonly retryOf: number } & ContextFormed
  }
}

export const TURN_RETRY_TEXT =
  'The previous attempt at this request stopped before you produced any reply (a failed model request or a DSH restart). Answer the latest user message above as if this were the first attempt.'

export const turnRetryMessage = (retryOf: number): UserMessage =>
  createUserMessage({
    content: [{ type: 'text', text: TURN_RETRY_TEXT }],
    source: { kind: 'turn-retry', retryOf, form: 'notice', summary: boundContextSummary('Retried the request') },
  })
