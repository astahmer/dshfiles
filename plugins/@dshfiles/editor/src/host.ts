import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { editorApi, MAX_SAVE_BYTES } from './api.js'
import { editorSettings } from './settings.js'
import { WorkspaceWriteError, writeWorkspaceFile } from './write-file.js'

interface StoredSessions {
  stat(sessionId: SessionId): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

/**
 * The Host `ctx.sessions` is the session store, but the Client `ISessions` face claims the same
 * `Context.sessions` name and wins the declaration merge, so the store shape is decoded here. `z.custom` keeps the
 * store's own reference: `z.object` would hand back a copy whose `get` runs without the store as `this`.
 */
const liveSessionsSchema = z.custom<{ get(sessionId: SessionId): { readonly header?: { readonly cwd?: string } } | undefined }>(
  value => typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function',
)

/** The same resolution `workspaceFiles` uses: the live session header first, then the persisted one. */
const sessionRoot = async (ctx: Context, sessionId: string): Promise<string> => {
  // SAFETY: an unknown id only misses both lookups below, which refuses the save.
  const id = sessionId as SessionId
  const liveSessions = liveSessionsSchema.safeParse(ctx.sessions)
  const live = liveSessions.success ? liveSessions.data.get(id)?.header?.cwd : undefined
  if (live !== undefined) return live
  const persistence: StoredSessions | undefined = ctx.get('sessionPersistence')
  const stored = (await persistence?.stat(id))?.header?.cwd
  if (stored === undefined) throw new Error('This session has no workspace directory to save into.')
  return stored
}

const editorHostApi = editorApi.host({
  write: async ({ input, ctx }) => {
    try {
      return await writeWorkspaceFile({
        root: await sessionRoot(ctx, input.sessionId),
        path: input.path,
        text: input.text,
        expectedSha256: input.expectedSha256,
        overwrite: input.overwrite,
        maxBytes: MAX_SAVE_BYTES,
      })
    } catch (error) {
      if (error instanceof WorkspaceWriteError) throw new PluginApiError(error.message, { code: error.code, cause: error })
      if (error instanceof Error && error.message.startsWith('This session')) throw new PluginApiError(error.message, { cause: error })
      // dshx logs an unexpected failure with its cause and sends the browser only a generic message, so Node fs paths stay on the Host.
      throw error
    }
  },
})

export default defineHost({
  name: '@dshfiles/editor',
  inject: ['sessions'],
  apis: [editorHostApi],
  settings: [editorSettings],
})
