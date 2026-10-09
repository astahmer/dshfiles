import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const MAX_SAVE_BYTES = 8 * 1024 * 1024

export const editorApi = defineApi({
  id: 'editor',
  version: 1,
  methods: {
    write: method({
      input: z.object({
        sessionId: z.string().min(1).max(128),
        path: z.string().min(1).max(4096),
        text: z.string().max(MAX_SAVE_BYTES),
        /** sha256 of the bytes the editor loaded; null creates a file that must not exist yet. */
        expectedSha256: sha256Schema.nullable(),
        /** Overwrite even when the file changed on disk since it was loaded. */
        overwrite: z.boolean().default(false),
      }),
      output: z.discriminatedUnion('status', [
        z.object({ status: z.literal('saved'), absolutePath: z.string(), sha256: sha256Schema, bytes: z.number().int().min(0) }),
        z.object({ status: z.literal('conflict'), currentSha256: sha256Schema.nullable() }),
      ]),
    }),
  },
})
