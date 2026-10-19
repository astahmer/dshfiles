import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { MAX_DRAFT_TEXT_CHARS, MAX_DRAFT_TITLE_CHARS, MAX_SAVED_DRAFTS, savedDraftSchema } from './draft-store.js'
import { MAX_PROMPTS, promptSchema } from './library.js'

const revisionSchema = z.number().int().positive()

export const promptStashStateSchema = z
  .object({
    revision: revisionSchema,
    prompts: z.array(promptSchema).max(MAX_PROMPTS),
  })
  .strict()

export const promptStashMutationSchema = z
  .object({
    kind: z.enum(['applied', 'conflict', 'limit']),
    revision: revisionSchema,
    prompts: z.array(promptSchema).max(MAX_PROMPTS),
  })
  .strict()

export const draftSnapshotSchema = z
  .object({
    revision: revisionSchema,
    drafts: z.array(savedDraftSchema).max(MAX_SAVED_DRAFTS),
  })
  .strict()

export const draftMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('applied'),
      revision: revisionSchema,
      drafts: z.array(savedDraftSchema).max(MAX_SAVED_DRAFTS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rejected'),
      reason: z.enum(['duplicate-id', 'limit', 'too-large', 'invalid-title']),
      revision: revisionSchema,
      drafts: z.array(savedDraftSchema).max(MAX_SAVED_DRAFTS),
    })
    .strict(),
])

export type DraftSnapshot = z.infer<typeof draftSnapshotSchema>
export type DraftMutation = z.infer<typeof draftMutationSchema>

const draftInputSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().max(MAX_DRAFT_TITLE_CHARS),
    text: z.string().max(MAX_DRAFT_TEXT_CHARS),
    now: z.string().datetime(),
  })
  .strict()

/** One shared prompt library and draft stash, owned by the Host so every browser reads the same rows. */
export const promptStashApi = defineApi({
  id: 'prompt-stash',
  version: 1,
  owner: '@dshfiles/prompt-stash',
  methods: {
    state: method({
      input: z.void(),
      output: promptStashStateSchema,
      description: 'The saved prompt library every browser and plugin shares. Read-only.',
      tool: { name: 'prompt_stash_state', readOnly: true },
    }),
    save: method({
      input: z.object({ prompt: promptSchema, expectedRevision: z.string().uuid().nullable() }).strict(),
      output: promptStashMutationSchema,
      description: 'Upsert one saved prompt, rejecting the write when another writer changed the stored revision since the caller read it.',
    }),
    remove: method({
      input: z.object({ id: z.string().uuid(), expectedRevision: z.string().uuid() }).strict(),
      output: promptStashMutationSchema,
      description: 'Remove one saved prompt, rejecting the write when its stored revision differs from the one the caller saw.',
    }),
    drafts: method({
      input: z.void(),
      output: draftSnapshotSchema,
      description: 'The saved plain-text composer drafts every browser and plugin shares. Read-only.',
      tool: { name: 'prompt_stash_drafts', readOnly: true },
    }),
    saveDraft: method({
      input: z.object({ draft: draftInputSchema }).strict(),
      output: draftMutationSchema,
      description: 'Save one plain-text draft, rejecting duplicates, invalid titles, oversized text and a full stash.',
    }),
    removeDraft: method({
      input: z.object({ id: z.string().uuid() }).strict(),
      output: draftSnapshotSchema,
      description: 'Remove one saved draft by id.',
    }),
  },
})
