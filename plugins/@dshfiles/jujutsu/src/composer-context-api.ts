import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { fileStatusSchema } from './api.js'

const bookmarkNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/)

/** What the composer bar compares the working copy against. */
export const composerBaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parent') }),
  z.object({ kind: z.literal('trunk') }),
  z.object({ kind: z.literal('bookmark'), name: bookmarkNameSchema }),
  z.object({ kind: z.literal('remoteBookmark'), name: bookmarkNameSchema, remote: bookmarkNameSchema }),
])

const cwdSchema = z.string().min(1).max(2048)

const repositorySchema = z.object({
  root: z.string().max(2048),
  workspace: z.string().max(128).nullable(),
  changeId: z.string().max(64),
  commitId: z.string().max(64),
  description: z.string().max(500),
  empty: z.boolean(),
  conflict: z.boolean(),
  bookmarks: z.array(z.string().max(256)).max(32),
  nearestBookmarks: z.array(z.string().max(256)).max(32),
  base: z.object({
    label: z.string().max(256),
    found: z.boolean(),
  }),
  revisionCounts: z.object({ ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative() }).strict().optional().nullable(),
  totals: z.object({ files: z.number().int().min(0), additions: z.number().int().min(0), deletions: z.number().int().min(0) }).nullable(),
  files: z.array(z.object({ path: z.string().max(2048), status: fileStatusSchema })).max(500),
  filesTruncated: z.boolean(),
  localBookmarks: z.array(z.string().max(256)).max(200),
  remoteBookmarks: z
    .array(z.object({ name: z.string().max(256), remote: z.string().max(256) }))
    .max(200)
    .optional(),
})

export const composerContextApi = defineApi({
  id: 'jujutsu-composer',
  version: 1,
  methods: {
    context: method({
      input: z.object({ cwd: cwdSchema, base: composerBaseSchema }),
      output: z.object({ repository: repositorySchema.nullable() }),
    }),
    diff: method({
      input: z.object({ cwd: cwdSchema, base: composerBaseSchema }),
      output: z.object({
        patch: z.string().max(1_200_000),
        truncated: z.boolean(),
        files: z.array(z.object({ path: z.string().max(2048), additions: z.number().int().min(0), deletions: z.number().int().min(0) })).max(2000),
      }),
    }),
  },
})

export type ComposerBase = z.infer<typeof composerBaseSchema>
export type ComposerRepository = z.infer<typeof repositorySchema>
