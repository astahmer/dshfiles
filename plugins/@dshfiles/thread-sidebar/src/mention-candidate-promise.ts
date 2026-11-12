import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Effect, Schema } from 'effect'

/** A stored header the persistence read could not answer for. */
class ThreadStatError extends Schema.TaggedError<ThreadStatError>()('ThreadStatError', {
  sessionId: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** The persisted header of one Session, read through the Host's Promise session persistence. */
export const statStoredThread = (input: { readonly ctx: CordisContext; readonly sessionId: SessionId }) =>
  Effect.tryPromise({
    try: () => input.ctx.sessionPersistence.stat(input.sessionId),
    catch: cause => new ThreadStatError({ sessionId: input.sessionId, cause }),
  })
