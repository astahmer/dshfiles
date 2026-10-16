import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * One `jj diff --git` for a whole thread can be large, and the RPC is one JSON
 * message, so the Host caps the patch it sends and flags the cut.
 */
export const MAX_PATCH_CHARS = 1_200_000
export const MAX_FILES = 4_000

export const scopeKeySchema = z.enum(['docs', 'code', 'tests', 'config', 'deps', 'generated', 'other'])
export type ScopeKey = z.infer<typeof scopeKeySchema>

export const reviewScopeSchema = z
  .object({
    key: scopeKeySchema,
    category: z.string().min(1).max(32),
    label: z.string().min(1).max(120),
    summary: z.string().min(1).max(400),
    filePaths: z.array(z.string().min(1).max(2048)).max(MAX_FILES),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
  })
  .strict()
export type ReviewScope = z.infer<typeof reviewScopeSchema>

export const reviewFileSchema = z
  .object({
    path: z.string().min(1).max(2048),
    status: z.string().max(32),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
  })
  .strict()
export type ReviewFile = z.infer<typeof reviewFileSchema>

export const reviewFailureReasonSchema = z.enum(['workspace-missing', 'not-a-repository', 'no-base', 'jj-missing', 'jj-failed'])
export type ReviewFailureReason = z.infer<typeof reviewFailureReasonSchema>

export const reviewResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      path: z.string().min(1).max(2048),
      base: z.string().min(1).max(256),
      head: z.string().min(1).max(256),
      range: z.string().min(1).max(512),
      patch: z.string().max(MAX_PATCH_CHARS),
      truncated: z.boolean(),
      fileCount: z.number().int().min(0),
      additions: z.number().int().min(0),
      deletions: z.number().int().min(0),
      files: z.array(reviewFileSchema).max(MAX_FILES),
      scopes: z.array(reviewScopeSchema).max(16),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      path: z.string().max(2048),
      reason: reviewFailureReasonSchema,
      message: z.string().min(1).max(600),
    })
    .strict(),
])
export type ReviewResult = z.infer<typeof reviewResultSchema>

export const pullsReviewApi = defineApi({
  id: 'pulls-review',
  owner: '@dshfiles/pulls-review',
  version: 1,
  methods: {
    review: method({
      input: z.object({ path: z.string().min(1).max(2048), base: z.string().min(1).max(256).optional() }),
      output: reviewResultSchema,
      description: "Read a workspace's changes since a base bookmark and group the changed files into review scopes.",
    }),
  },
})
