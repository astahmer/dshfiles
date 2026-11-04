import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { HostContext, hostService } from '@dshfiles/dshx/effect'
import { Duration, Effect, Layer, Option, Schema } from 'effect'
import { SessionForkFailed, UndoSessions } from './undo-service.js'

const PROJECTIONS_TIMEOUT = Duration.seconds(30)

const modelSelectionSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningEffort: Schema.optional(Schema.String),
})
const projectedSelectionSchema = Schema.Struct({ next: Schema.NullOr(modelSelectionSchema), lastUsed: Schema.NullOr(modelSelectionSchema) })

/** The Session controller and workspace registry, read at each call because either may load after this plugin. */
export const undoSessionsLayer = Layer.effect(
  UndoSessions,
  Effect.gen(function* () {
    const host = yield* HostContext
    const controller = Effect.provideService(hostService('sessionController'), HostContext, host)
    const registry = Effect.provideService(hostService('workspaceRegistry'), HostContext, host)
    const bestEffort = (operation: string) => (effect: Effect.Effect<unknown, unknown>) =>
      effect.pipe(
        Effect.asVoid,
        Effect.catchCause(cause => Effect.logDebug(`session-undo: ${operation} skipped`, cause)),
      )

    return UndoSessions.of({
      fork: Effect.fn('session undo fork')(function* (input: { readonly sessionId: string; readonly atSeq: number }) {
        const sessions = yield* controller.pipe(Effect.mapError(cause => new SessionForkFailed({ cause })))
        const forked = yield* Effect.tryPromise({
          try: () => sessions.fork({ sessionId: SessionId(input.sessionId), atSeq: input.atSeq }),
          catch: cause => new SessionForkFailed({ cause }),
        })
        return String(forked.sessionId)
      }),
      copyModel: input =>
        Effect.gen(function* () {
          const sessions = yield* controller
          const projected = yield* Effect.tryPromise(signal => sessions.projections({ sessionId: SessionId(input.from) }, signal)).pipe(
            Effect.timeout(PROJECTIONS_TIMEOUT),
          )
          const values = projected?.kind === 'sequenced' ? projected.values : projected?.values
          const selection = Option.getOrNull(Schema.decodeUnknownOption(projectedSelectionSchema)(values?.modelSelection))
          const chosen = selection === null ? null : (selection.next ?? selection.lastUsed)
          if (chosen === null) return
          const route = { sessionId: SessionId(input.to), provider: chosen.provider, model: chosen.model }
          yield* Effect.tryPromise(() =>
            sessions.selectModel(chosen.reasoningEffort === undefined ? route : { ...route, reasoningEffort: chosen.reasoningEffort }),
          )
        }).pipe(bestEffort('model copy'), Effect.withSpan('session undo model copy')),
      archive: sessionId => Effect.flatMap(registry, found => Effect.tryPromise(() => found.archiveSession(SessionId(sessionId)))).pipe(bestEffort('archive')),
      unarchive: sessionId =>
        Effect.flatMap(registry, found => Effect.tryPromise(() => found.unarchiveSession(SessionId(sessionId)))).pipe(bestEffort('unarchive')),
    })
  }),
)
