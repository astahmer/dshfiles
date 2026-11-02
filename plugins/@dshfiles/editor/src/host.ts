import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { type ApiCaller, PluginApiError } from '@dshfiles/dshx/api'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { editorApi, MAX_SAVE_BYTES } from './api.js'
import { editorSettings } from './settings.js'
import { WorkspaceWriteError, writeWorkspaceFile } from './write-file.js'

interface StoredSessions {
  stat(sessionId: SessionId): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

interface LiveSessions {
  get(sessionId: SessionId): { readonly header?: { readonly cwd?: string } } | undefined
}

/**
 * The Host `ctx.sessions` is the session store, but the Client `ISessions` face claims the same
 * `Context.sessions` name and wins the declaration merge, so the store shape is decoded here. `z.custom` keeps the
 * store's own reference: `z.object` would hand back a copy whose `get` runs without the store as `this`.
 */
const liveSessionsSchema = Schema.declare<LiveSessions>(
  (value): value is LiveSessions => typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function',
)

class SessionWorkspaceMissing extends Schema.TaggedError<SessionWorkspaceMissing>()('SessionWorkspaceMissing', {
  message: Schema.String,
}) {}

class EditorWorkspaceWriteFailure extends Schema.TaggedError<EditorWorkspaceWriteFailure>()('EditorWorkspaceWriteFailure', {
  code: Schema.String,
  message: Schema.String,
}) {}

class EditorHostServices extends EffectContext.Service<
  EditorHostServices,
  {
    readonly sessionRoot: (sessionId: string) => Effect.Effect<string, unknown>
  }
>()('dshfiles/editor/EditorHostServices') {}

const editorPlugin = DshxEffect.plugin({
  layer: (ctx: Context) => {
    const sessions: unknown = ctx.sessions
    const liveSessions = Schema.is(liveSessionsSchema)(sessions) ? sessions : undefined
    const persistence: StoredSessions | undefined = ctx.get('sessionPersistence')
    return Layer.succeed(EditorHostServices, {
      sessionRoot: Effect.fn('editor resolve workspace')((sessionId: string) =>
        Effect.gen(function* () {
          // SAFETY: an unknown id only misses both lookups below, which refuses the save.
          const id = sessionId as SessionId
          const live = liveSessions?.get(id)?.header?.cwd
          if (live !== undefined) return live
          let storedRoot: string | undefined
          if (persistence !== undefined) {
            const stored = yield* Effect.tryPromise({ try: () => persistence.stat(id), catch: error => error })
            storedRoot = stored?.header?.cwd
          }
          if (storedRoot === undefined)
            return yield* Effect.fail(new SessionWorkspaceMissing({ message: 'This session has no workspace directory to save into.' }))
          return storedRoot
        }),
      ),
    })
  },
  setup: () => Effect.void,
})

/** The session a save targets: the named one, else the calling Agent's own session. */
const targetSessionId = (requested: string | undefined, caller: ApiCaller): string => {
  if (requested !== undefined) return requested
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return caller.sessionId
  throw new PluginApiError('Pass sessionId: this tool cannot tell which thread workspace to save into.')
}

const editorHostApi = editorPlugin.hostApi(editorApi, {
  write: Effect.fn('editor write')(({ input, caller }) =>
    Effect.gen(function* () {
      const sessionId = targetSessionId(input.sessionId, caller)
      const host = yield* EditorHostServices
      const root = yield* host.sessionRoot(sessionId)
      return yield* Effect.tryPromise({
        try: () =>
          writeWorkspaceFile({
            root,
            path: input.path,
            text: input.text,
            expectedSha256: input.expectedSha256,
            overwrite: input.overwrite ?? false,
            maxBytes: MAX_SAVE_BYTES,
          }),
        catch: error => (error instanceof WorkspaceWriteError ? new EditorWorkspaceWriteFailure({ code: error.code, message: error.message }) : error),
      })
    }).pipe(
      Effect.mapError(error => {
        if (error instanceof SessionWorkspaceMissing) return new PluginApiError(error.message, { cause: error })
        if (error instanceof EditorWorkspaceWriteFailure) return new PluginApiError(error.message, { code: error.code, cause: error })
        return error
      }),
    ),
  ),
})

export default defineHost({
  name: '@dshfiles/editor',
  inject: ['sessions', 'sessionPersistence'],
  apis: [editorHostApi],
  settings: [editorSettings],
  setup: editorPlugin.setup,
})
