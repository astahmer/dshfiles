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

/** Rows one history read returns at most. */
export const HISTORY_LIMIT_MAX = 100

const historyPromptSchema = Schema.Struct({
  sessionId: Schema.String,
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  time: Schema.Number.check(Schema.isFinite()),
  text: Schema.String,
})
export type HistoryPrompt = typeof historyPromptSchema.Type

export const promptHistoryInputSchema = Schema.Struct({
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(HISTORY_LIMIT_MAX))),
})

export const promptHistorySchema = Schema.Struct({
  /** `disabled`: the promptHistory setting is off; `unavailable`: no session-search index serves this profile. */
  status: Schema.Literals(['ready', 'disabled', 'unavailable']),
  prompts: Schema.Array(historyPromptSchema).check(Schema.isMaxLength(HISTORY_LIMIT_MAX)),
})
export type PromptHistory = typeof promptHistorySchema.Type

const renderHistory = (history: PromptHistory): string => {
  if (history.status === 'disabled') return 'Prompt history is off. Turn on promptHistory in the Prompt Stash settings to search it.'
  if (history.status === 'unavailable') return 'Prompt history needs the @dshfiles/session-search plugin, which does not serve this profile.'
  if (history.prompts.length === 0) return 'No sent prompt matches.'
  return history.prompts.map(prompt => `${new Date(prompt.time).toISOString()} · ${prompt.sessionId} · ${prompt.text.slice(0, 300)}`).join('\n')
}

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
    // Added after the first release: a Host started before it answers with an unknown-endpoint error.
    history: method({
      input: promptHistoryInputSchema,
      output: promptHistorySchema,
      description:
        'Search the prompts the user sent across every top-level thread, newest first, each text once: the newest prompts the historyRetention setting keeps, without prompts longer than historyMaxChars. `text` keeps prompts holding every word (the last may be a prefix); without it the newest prompts are listed. `limit` defaults to 30. Read-only.',
      tool: { name: 'prompt_history_search', readOnly: true, render: renderHistory },
    }),
  },
})
