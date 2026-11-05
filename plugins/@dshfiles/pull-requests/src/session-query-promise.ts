import type { SessionEventResultFilter, SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@dshfiles/dshx/ids'
import { Effect } from 'effect'

/**
 * The one edge where pull-requests adapts DSH's Promise `sessionQuery` service; the rest of the plugin sees Effects.
 * Each read fails with the service's own cause, so callers choose the fallback. Title reads abort on interruption.
 */
export const sessionQueryReads = (sessionQuery: SessionQueryEngine) => ({
  readSession: (id: SessionId) => Effect.tryPromise(() => sessionQuery.readSession(id)),
  readTitle: (id: SessionId) => Effect.tryPromise(signal => sessionQuery.readTitle(id, signal)),
  filterEvents: (id: SessionId, filters: readonly SessionEventResultFilter[]) => Effect.tryPromise(() => sessionQuery.filterEvents(id, filters)),
})
