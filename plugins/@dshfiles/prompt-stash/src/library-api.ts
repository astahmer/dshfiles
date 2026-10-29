import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
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

export type PromptStashSnapshot = z.infer<typeof promptStashStateSchema>
export type PromptStashMutation = z.infer<typeof promptStashMutationSchema>

/** One shared prompt library, owned by the Host so every browser reads the same rows. */
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
  },
})
