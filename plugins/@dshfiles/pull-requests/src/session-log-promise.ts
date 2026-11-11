import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@dshfiles/dshx/ids'
import { recentLogEvents } from '@dshfiles/session-log-window'
import { Effect } from 'effect'

/**
 * The one edge where pull-requests adapts the Promise reader of a stored log's newest events; the rest of the plugin
 * sees an Effect. The read aborts on interruption and fails with the reader's own cause, so callers choose the fallback.
 */
export const readRecentLogEvents = (input: {
  readonly ctx: CordisContext
  readonly sessionId: SessionId
  readonly matches: (event: SessionEvent) => boolean
  readonly keep: number
}) => Effect.tryPromise(signal => recentLogEvents({ ...input, signal }))
