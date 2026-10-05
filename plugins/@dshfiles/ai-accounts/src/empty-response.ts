/**
 * The empty-response guard for the Command Code route.
 *
 * pi-ai's `openai-completions` transport settles a response that carried
 * reasoning but no answer text and no tool call as `stopReason: 'stop'` with no
 * model-visible content. DSH reads that as a completed turn, and the goal-round
 * driver reads a completed turn as "keep going", so a degraded provider burns
 * the whole round budget: `session-dbe87c63` ran 111 consecutive content-free
 * rounds over 60.9 hours before anyone noticed.
 *
 * Nothing upstream classifies this. pi-ai exposes `maxRetries` but no
 * `retryableCodes`, so the transport has no vocabulary for "this attempt
 * failed" even when it should. Raising a coded `LlmError` here is what puts the
 * attempt back in front of the retry policy instead of in front of the user.
 */

/** Stable provider-neutral code, matching what a retry policy lists. */
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'

interface SettlementBlock {
  readonly type?: string
  readonly text?: string
}

interface Settlement {
  readonly content?: readonly SettlementBlock[]
  /** pi-ai's own stop reason; only `stop` and `length` can be a failed attempt. */
  readonly stopReason?: string
}

/**
 * Whether a settled response actually answered.
 *
 * Only an explicit `text` or `toolCall` block counts. Reasoning is excluded by
 * type, not by emptiness: a thinking block has non-empty text, so testing its
 * content would count reasoning as an answer and defeat the whole guard.
 */
export const settlementAnswered = (message: Settlement | undefined): boolean => {
  if (message === undefined) return false
  const content = message.content
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (block.type === 'toolCall') return true
    return block.type === 'text' && (block.text ?? '').trim().length > 0
  })
}

export interface EmptyResponseDetail {
  /** The model that produced nothing, for a message a human can act on. */
  readonly model: string | undefined
  /** pi-ai's own stop reason, kept because `length` means something different. */
  readonly stopReason: string | undefined
  /** Raw provider finish reason, when one was reported. */
  readonly rawStopReason: string | undefined
}

/**
 * True when this settlement is a failed attempt rather than a finished turn.
 *
 * Only `stop` and `length` qualify. An `error` stop already raises inside the
 * transport, and `aborted` or `toolUse` are not empty responses at all.
 */
export const isEmptyCompletion = (message: Settlement | undefined): boolean => {
  if (message === undefined) return false
  const reason = message.stopReason
  if (reason !== 'stop' && reason !== 'length') return false
  return !settlementAnswered(message)
}

export const describeEmptyResponse = (detail: EmptyResponseDetail): string =>
  [
    `Command Code returned no answer text or tool call for model "${detail.model ?? 'unknown'}"`,
    detail.stopReason === undefined ? undefined : `stop_reason=${detail.stopReason}`,
    detail.rawStopReason === undefined ? undefined : `finish_reason=${detail.rawStopReason}`,
  ]
    .filter(part => part !== undefined)
    .join(', ')
