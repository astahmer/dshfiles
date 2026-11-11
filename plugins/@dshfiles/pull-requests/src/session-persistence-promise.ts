import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@dshfiles/dshx/ids'
import { Effect } from 'effect'

/**
 * The one edge where pull-requests adapts DSH's Promise `sessionPersistence` service; the rest of the plugin sees an
 * Effect. Succeeds with `undefined` when the Host has no persistence service; the read aborts on interruption and fails
 * with the service's own cause, so callers choose the fallback.
 */
export const statStoredSession = (ctx: CordisContext, sessionId: SessionId) => {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return Effect.succeed(undefined)
  return Effect.tryPromise(signal => persistence.stat(sessionId, { signal }))
}
