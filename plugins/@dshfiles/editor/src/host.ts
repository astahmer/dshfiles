import type {} from '@deepseek-ai/dsh-session'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { SessionId } from '@dshfiles/dshx/ids'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { editorApi, type editorWriteInputSchema, MAX_SAVE_BYTES } from './api.js'
import { SessionLookupFailed, storedSessionRoot, type StoredSessions } from './session-store-promise.js'
import { editorSettings } from './settings.js'
import { WorkspaceWrite } from './workspace-write.js'

interface LiveSessions {
  get(sessionId: SessionId): { readonly header?: { readonly cwd?: string } } | undefined
}

/**
 * The Host `ctx.sessions` is the session store, but the Client `ISessions` face claims the same `Context.sessions`
 * name and wins the declaration merge, so the store shape is decoded here. `Schema.declare` keeps the store's own
 * reference, so `get` runs with the store as `this`.
 */
const liveSessionsSchema = Schema.declare<LiveSessions>(
  (value): value is LiveSessions => typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function',
)
const liveSessionsOf = Schema.decodeUnknownOption(liveSessionsSchema)
const decodeSessionId = Schema.decodeUnknownEffect(SessionId)

class SessionRequired extends Schema.TaggedError<SessionRequired>()(
  'SessionRequired',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-required' },
) {
  override get message(): string {
    return 'Pass sessionId: this tool cannot tell which thread workspace to save into.'
  }
}

class SessionWorkspaceMissing extends Schema.TaggedError<SessionWorkspaceMissing>()(
  'SessionWorkspaceMissing',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-workspace-missing' },
) {
  override get message(): string {
    return 'This session has no workspace directory to save into.'
  }
}

/** The workspace directory of a live or persisted session, read from the Host session store. */
class SessionWorkspaces extends Context.Service<
  SessionWorkspaces,
  { readonly root: (sessionId: string) => Effect.Effect<string, SessionWorkspaceMissing | SessionLookupFailed> }
>()('@dshfiles/editor/SessionWorkspaces') {
  static readonly layer = Layer.effect(
    SessionWorkspaces,
    Effect.gen(function* () {
      const host = yield* HostContext
      const liveSessions = liveSessionsOf(host.ctx.sessions)
      const storedSessions: StoredSessions | undefined = host.ctx.get('sessionPersistence')
      const persistence = Option.fromNullishOr(storedSessions)
      return SessionWorkspaces.of({
        root: Effect.fn('editor resolve workspace')(function* (rawSessionId: string) {
          const sessionId = yield* decodeSessionId(rawSessionId).pipe(Effect.mapError(cause => new SessionWorkspaceMissing({ sessionId: rawSessionId, cause })))
          const live = Option.flatMapNullishOr(liveSessions, sessions => sessions.get(sessionId)?.header?.cwd)
          if (Option.isSome(live)) return live.value
          if (Option.isNone(persistence)) return yield* new SessionWorkspaceMissing({ sessionId })
          const storedRoot = yield* storedSessionRoot({ store: persistence.value, sessionId })
          if (storedRoot === undefined) return yield* new SessionWorkspaceMissing({ sessionId })
          return storedRoot
        }),
      })
    }),
  )
}

/** The session a save targets: the named one, else the calling Agent's own session. */
const targetSessionId = (requested: string | undefined, caller: ApiCaller) => {
  if (requested !== undefined) return Effect.succeed(requested)
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return Effect.succeed(caller.sessionId)
  return Effect.fail(new SessionRequired())
}

const editorWrite = Effect.fn('editor write')(function* (input: typeof editorWriteInputSchema.Type, caller: ApiCaller) {
  const sessionId = yield* targetSessionId(input.sessionId, caller)
  const root = yield* SessionWorkspaces.use(workspaces => workspaces.root(sessionId))
  return yield* WorkspaceWrite.use(files =>
    files.write({
      root,
      path: input.path,
      text: input.text,
      expectedSha256: input.expectedSha256,
      overwrite: input.overwrite ?? false,
      maxBytes: MAX_SAVE_BYTES,
    }),
  )
})

export default DshxPlugin.make({
  name: '@dshfiles/editor',
  inject: ['sessions', 'sessionPersistence'],
  settings: [editorSettings],
  layer: Layer.mergeAll(SessionWorkspaces.layer, WorkspaceWrite.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))),
  apis: [Api.bind(editorApi, { write: (input, call) => editorWrite(input, call.caller) })],
})
