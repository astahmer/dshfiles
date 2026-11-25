/**
 * The seat the owned Chat fork adds beside Retry on a terminal turn error: the one row of recovery actions.
 *
 * Published as its own contract module (`@dshfiles/chat/turn-error-action`) so
 * a feature plugin can fill it without importing the whole Chat contract.
 */
/** Owner currency of one terminal turn error's appended actions. */
export interface TurnErrorActionOwnerProps {
  /** Closing sequence of the failed turn, stable across reloads. */
  readonly seq: number
  /** Failure code the Host retained on the turn error. */
  readonly code: string
  /** Failure text the Host retained on the turn error, as the provider or the Host worded it. */
  readonly message: string
}

/** Codes a provider or the Host sets when no usable key or sign-in reached the model. */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'])
/** Core's own wording for a route with no key, e.g. `llm-deepseek: no API key for provider route "…"`. */
const NO_KEY_TEXT = /\bno API key\b|\bmissing (?:an? )?API key\b/i
const STATUS_PREFIX = /^\s*(\d{3})\s*:/

/**
 * One reading of a terminal failure for every action in the seat, so the card, "Ask to fix" and the account action
 * agree on what can change the outcome.
 */
export const TurnFailure = {
  /** The HTTP status a provider failure starts with (`401: {…}`), when it carries one. */
  status(message: string): number | undefined {
    const status = STATUS_PREFIX.exec(message)?.[1]
    return status === undefined ? undefined : Number(status)
  },

  /** No account or key can run the model: retrying or asking the same model cannot succeed. */
  isCredential(failure: Pick<TurnErrorActionOwnerProps, 'code' | 'message'>): boolean {
    const status = TurnFailure.status(failure.message)
    return CREDENTIAL_CODES.has(failure.code.trim()) || status === 401 || status === 403 || NO_KEY_TEXT.test(failure.message)
  },

  /** Whether Retry is the primary: a client error other than a timeout (408) or a rate limit (429) fails again. */
  retryLeads(failure: Pick<TurnErrorActionOwnerProps, 'code' | 'message'>): boolean {
    if (TurnFailure.isCredential(failure)) return false
    const status = TurnFailure.status(failure.message)
    return status === undefined || status < 400 || status >= 500 || status === 408 || status === 429
  },
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Ordered additions beside a terminal turn error's Retry action. Each entry
     * receives the failed turn's sequence, code and message; entries without
     * content return null.
     */
    'conversation.chat.turnErrorAction': { kind: 'list'; scope: 'session'; owner: TurnErrorActionOwnerProps }
  }
}
