import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineHost } from '@dshfiles/dshx/host'
import { editorApi, MAX_SAVE_BYTES } from './api.js'
import { editorSettings } from './settings.js'
import { WorkspaceWriteError, writeWorkspaceFile } from './write-file.js'

interface StoredSessions {
  stat(sessionId: SessionId): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

/** The same resolution `workspaceFiles` uses: the live session header first, then the persisted one. */
const sessionRoot = async (ctx: Context, sessionId: string): Promise<string> => {
  // SAFETY: an unknown id only misses both lookups below, which refuses the save.
  const id = sessionId as SessionId
  const live = ctx.sessions.get(id)?.header.cwd
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
      if (error instanceof WorkspaceWriteError) throw new Error(error.message)
      if (error instanceof Error && error.message.startsWith('This session')) throw error
      // Node fs messages carry absolute paths of unrelated directories; keep them out of the browser.
      throw new Error('The file could not be saved.')
    }
  },
})

export default defineHost({
  name: '@dshfiles/editor',
  inject: ['sessions'],
  apis: [editorHostApi],
  settings: [editorSettings],
})
