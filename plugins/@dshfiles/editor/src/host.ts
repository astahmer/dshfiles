import type {} from '@deepseek-ai/dsh-session'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { SessionId } from '@dshfiles/dshx/ids'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { editorApi, type editorWriteInputSchema, MAX_SAVE_BYTES } from './api.js'
import { editorArtifactsApi } from './artifacts-api.js'
import { ArtifactStore } from './artifact-store.js'
import { type SessionLookupFailed, storedSessionExists, storedSessionRoot, type StoredSessions } from './session-store-promise.js'
import { editorSettings } from './settings.js'
import { WorkspaceWrite } from './workspace-write.js'

interface LiveSessions {
  get(sessionId: SessionId): { readonly header?: { readonly cwd?: string; readonly origin?: string; readonly parentSession?: string } } | undefined
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
const sessionIdOf = Schema.decodeUnknownOption(SessionId)

class SessionRequired extends Schema.TaggedError<SessionRequired>()(
  'SessionRequired',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-required' },
) {
  override get message(): string {
    return 'Pass sessionId: this tool cannot tell which thread workspace to save into.'
  }
}

class SessionNotFound extends Schema.TaggedError<SessionNotFound>()(
  'SessionNotFound',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-not-found' },
) {
  override get message(): string {
    return `No thread ${this.sessionId} exists. Pass the sessionId of an open or stored thread.`
  }
}

class SessionOutOfReach extends Schema.TaggedError<SessionOutOfReach>()(
  'SessionOutOfReach',
  { sessionId: Schema.String },
  { dshxWireCode: 'session-out-of-reach' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} is not yours: an agent reaches only its own thread and its subagents.`
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

/** The live and persisted sessions as the editor reads them: their workspace directory, whether they exist, and their subagent parent. */
class SessionWorkspaces extends Context.Service<
  SessionWorkspaces,
  {
    readonly root: (sessionId: string) => Effect.Effect<string, SessionWorkspaceMissing | SessionLookupFailed>
    readonly exists: (sessionId: string) => Effect.Effect<boolean, SessionLookupFailed>
    readonly parentOf: (sessionId: string) => string | undefined
  }
>()('@dshfiles/editor/SessionWorkspaces') {
  static readonly layer = Layer.effect(
    SessionWorkspaces,
    Effect.gen(function* () {
      const host = yield* HostContext
      const liveSessions = liveSessionsOf(host.ctx.sessions)
      const storedSessions: StoredSessions | undefined = host.ctx.get('sessionPersistence')
      const persistence = Option.fromNullishOr(storedSessions)
      const liveHeader = (sessionId: string) =>
        Option.flatMap(sessionIdOf(sessionId), id => Option.flatMapNullishOr(liveSessions, sessions => sessions.get(id)?.header))
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
        exists: Effect.fn('editor session exists')(function* (rawSessionId: string) {
          const decoded = sessionIdOf(rawSessionId)
          if (Option.isNone(decoded)) return false
          if (Option.isSome(Option.flatMapNullishOr(liveSessions, sessions => sessions.get(decoded.value)))) return true
          if (Option.isNone(persistence)) return false
          return yield* storedSessionExists({ store: persistence.value, sessionId: decoded.value })
        }),
        parentOf: sessionId => {
          const header = Option.getOrUndefined(liveHeader(sessionId))
          return header?.origin === 'subagent' ? header.parentSession : undefined
        },
      })
    }),
  )
}

/**
 * The session a call targets: the named one, else the calling Agent's own. It must exist, and an agent reaches only its
 * own thread and the subagent threads below it, so one thread's agent cannot read or write another thread's files.
 */
const targetSessionId = Effect.fn('editor target session')(function* (requested: string | undefined, caller: ApiCaller) {
  const sessionId = requested ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  if (sessionId === undefined) return yield* new SessionRequired()
  const sessions = yield* SessionWorkspaces
  const reaches = (agentSessionId: string | undefined): boolean => {
    const visited = new Set<string>()
    for (let current: string | undefined = sessionId; current !== undefined && !visited.has(current); current = sessions.parentOf(current)) {
      if (current === agentSessionId) return true
      visited.add(current)
    }
    return false
  }
  if (caller.kind === 'agent' && !reaches(caller.sessionId)) return yield* new SessionOutOfReach({ sessionId })
  if (!(yield* sessions.exists(sessionId))) return yield* new SessionNotFound({ sessionId })
  return sessionId
})

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
  layer: Layer.mergeAll(
    SessionWorkspaces.layer,
    ArtifactStore.layer,
    WorkspaceWrite.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  ),
  apis: [
    Api.bind(editorApi, { write: (input, call) => editorWrite(input, call.caller) }),
    Api.bind(editorArtifactsApi, {
      list: (input, call) =>
        Effect.gen(function* () {
          const session = yield* targetSessionId(input.sessionId, call.caller)
          return yield* ArtifactStore.use(store => store.list(session))
        }),
      read: (input, call) =>
        Effect.gen(function* () {
          const session = yield* targetSessionId(input.sessionId, call.caller)
          return yield* ArtifactStore.use(store => store.read(session, input.id))
        }),
      create: (input, call) =>
        Effect.gen(function* () {
          const session = yield* targetSessionId(input.sessionId, call.caller)
          return yield* ArtifactStore.use(store => store.create(session, input))
        }),
      update: (input, call) =>
        Effect.gen(function* () {
          const session = yield* targetSessionId(input.sessionId, call.caller)
          return yield* ArtifactStore.use(store => store.update(session, input))
        }),
      delete: (input, call) =>
        Effect.gen(function* () {
          const session = yield* targetSessionId(input.sessionId, call.caller)
          return yield* ArtifactStore.use(store => store.delete(session, input))
        }),
    }),
  ],
})
