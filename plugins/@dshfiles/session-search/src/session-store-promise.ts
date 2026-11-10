import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection, SessionPersistence, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { Effect, Schema } from 'effect'

/** The Session persistence service refused a listing, a stat or a log read. */
export class SessionStoreFailed extends Schema.TaggedError<SessionStoreFailed>()('SessionStoreFailed', {
  operation: Schema.String,
  sessionId: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

/** The plugin's promise edge onto the native `sessionPersistence` service. */
export class SessionStore {
  static list(persistence: SessionPersistence): Effect.Effect<readonly SessionPersistenceSnapshot[], SessionStoreFailed> {
    return Effect.tryPromise({ try: signal => persistence.list({ signal }), catch: cause => new SessionStoreFailed({ operation: 'list', cause }) })
  }

  static exists(persistence: SessionPersistence, sessionId: SessionId): Effect.Effect<boolean, SessionStoreFailed> {
    return Effect.tryPromise({
      try: async signal => (await persistence.stat(sessionId, { signal })) !== undefined,
      catch: cause => new SessionStoreFailed({ operation: 'stat', sessionId, cause }),
    })
  }

  /** One stored Session's complete log through a read handle, which never takes write ownership. */
  static inspect(persistence: SessionPersistence, sessionId: SessionId): Effect.Effect<SessionInspection, SessionStoreFailed> {
    return Effect.acquireUseRelease(
      Effect.tryPromise({
        try: signal => persistence.open(sessionId, 'read', { signal }),
        catch: cause => new SessionStoreFailed({ operation: 'open', sessionId, cause }),
      }),
      handle =>
        Effect.tryPromise({
          try: async signal => ({
            meta: handle.header,
            inheritedEventCount: handle.inheritedEventCount,
            events: (await handle.read(0, undefined, { signal })).events,
          }),
          catch: cause => new SessionStoreFailed({ operation: 'read', sessionId, cause }),
        }),
      handle => Effect.ignore(Effect.tryPromise(() => handle.close())),
    )
  }
}
