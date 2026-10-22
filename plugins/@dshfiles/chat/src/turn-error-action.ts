/**
 * The seat the owned Chat fork adds beside Resume on a terminal turn error.
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
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Ordered additions beside a terminal turn error's Resume action. Each entry
     * receives the failed turn's sequence and code; entries without content
     * return null.
     */
    'conversation.chat.turnErrorAction': { kind: 'list'; scope: 'session'; owner: TurnErrorActionOwnerProps }
  }
}
