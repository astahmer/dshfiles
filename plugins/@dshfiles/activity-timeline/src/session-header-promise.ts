import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { Effect, Option, Schema } from 'effect'
import type { ThreadLineageHeader } from './thread-lineage.js'

/** A stored Session header the persistence service refused to read; the rollup treats it as absent. */
export class SessionHeaderUnreadable extends Schema.TaggedError<SessionHeaderUnreadable>()('SessionHeaderUnreadable', {
  sessionId: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Header-only lineage: the rollup needs a stored Session's origin and parent, never its event log. The native
 * persistence service answers Promises, so this is the plugin's promise edge for it.
 */
export const threadHeaderOf = (options: {
  readonly persistence: SessionPersistence
  readonly sessionId: string
}): Effect.Effect<ThreadLineageHeader | undefined> =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.option(
      Effect.tryPromise({
        try: signal => options.persistence.stat(SessionId(options.sessionId), { signal }),
        catch: cause => new SessionHeaderUnreadable({ sessionId: options.sessionId, cause }),
      }),
    )
    const header = Option.isNone(snapshot) ? undefined : snapshot.value?.header
    if (header === undefined) return undefined
    const lineage: ThreadLineageHeader = {}
    const withOrigin: ThreadLineageHeader = header.origin === 'subagent' ? { ...lineage, origin: 'subagent' } : lineage
    return header.parentSession === undefined ? withOrigin : { ...withOrigin, parentSessionId: header.parentSession }
  })
