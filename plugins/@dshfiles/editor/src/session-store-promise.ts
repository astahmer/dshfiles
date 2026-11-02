import type { SessionId } from '@dshfiles/dshx/ids'
import { Effect, Schema } from 'effect'

/** The persisted-session half of the Host session store, as the editor reads it. */
export interface StoredSessions {
  stat(sessionId: SessionId): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

/** The session store failed to read a persisted session; the save was not attempted. */
export class SessionLookupFailed extends Schema.TaggedError<SessionLookupFailed>()('SessionLookupFailed', {
  sessionId: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The session store could not be read.'
  }
}

/** The workspace directory a persisted session recorded, if any. */
export const storedSessionRoot = (input: { readonly store: StoredSessions; readonly sessionId: SessionId }) =>
  Effect.tryPromise({
    try: () => input.store.stat(input.sessionId),
    catch: cause => new SessionLookupFailed({ sessionId: input.sessionId, cause }),
  }).pipe(Effect.map(stored => stored?.header?.cwd))
