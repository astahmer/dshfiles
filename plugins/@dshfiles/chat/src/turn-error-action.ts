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
