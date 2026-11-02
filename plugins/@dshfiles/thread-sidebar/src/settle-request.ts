import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

/**
 * The jj-integration notice asks for one integrated thread to be settled through this window event (its
 * `settle-request.ts`). This plugin owns the settled status, so it answers: a handled request is cancelled, which
 * tells the notice that no button has to stay around.
 */
export const SETTLE_THREAD_EVENT = 'dshfiles:thread-settle'

const requestSchema = SchemaHelpers.strictStruct(Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)) }))

/** The session a `dshfiles:thread-settle` request names, or undefined for any other event or shape. */
export const readSettleThreadRequest = (event: Event): string | undefined => {
  if (!(event instanceof CustomEvent)) return undefined
  const request = SchemaHelpers.decodeUnknownSafe(requestSchema, event.detail)
  return request.success ? request.data.sessionId : undefined
}

/** Answer settle requests until the returned cleanup runs; a handled request comes back cancelled for the notice. */
export const answerSettleRequests = (settle: (sessionId: string) => void): (() => void) => {
  const listener = (event: Event): void => {
    const sessionId = readSettleThreadRequest(event)
    if (sessionId === undefined) return
    event.preventDefault()
    settle(sessionId)
  }
  window.addEventListener(SETTLE_THREAD_EVENT, listener)
  return () => window.removeEventListener(SETTLE_THREAD_EVENT, listener)
}
