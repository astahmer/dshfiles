import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { MAX_PROMPTS, promptSchema, type SavedPrompt } from './library.js'
import { uuidSchema } from './schema.js'

const revisionSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const promptListSchema = Schema.Array(promptSchema).check(Schema.isMaxLength(MAX_PROMPTS))

export const promptStashStateSchema = Schema.Struct({ revision: revisionSchema, prompts: promptListSchema })

export const promptStashMutationSchema = Schema.Struct({
  kind: Schema.Literals(['applied', 'conflict', 'limit']),
  revision: revisionSchema,
  prompts: promptListSchema,
})

export interface PromptStashSnapshot {
  readonly revision: number
  readonly prompts: readonly SavedPrompt[]
}

export interface PromptStashMutation {
  readonly kind: 'applied' | 'conflict' | 'limit'
  readonly revision: number
  readonly prompts: readonly SavedPrompt[]
}

/** One shared prompt library, owned by the Host so every browser reads the same rows. */
export const promptStashApi = defineApi({
  id: 'prompt-stash',
  version: 1,
  owner: '@dshfiles/prompt-stash',
  methods: {
    state: method({
      input: Schema.Void,
      output: promptStashStateSchema,
      description: 'The saved prompt library every browser and plugin shares. Read-only.',
      tool: { name: 'prompt_stash_state', readOnly: true },
    }),
    save: method({
      input: Schema.Struct({ prompt: promptSchema, expectedRevision: Schema.NullOr(uuidSchema) }),
      output: promptStashMutationSchema,
      description: 'Upsert one saved prompt, rejecting the write when another writer changed the stored revision since the caller read it.',
    }),
    remove: method({
      input: Schema.Struct({ id: uuidSchema, expectedRevision: uuidSchema }),
      output: promptStashMutationSchema,
      description: 'Remove one saved prompt, rejecting the write when its stored revision differs from the one the caller saw.',
    }),
  },
})
