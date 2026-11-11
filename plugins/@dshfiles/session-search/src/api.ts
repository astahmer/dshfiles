import { defineApi, method as defineMethod } from '@dshfiles/dshx/api'
import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import {
  FIND_LIMIT_MAX,
  findMatchSchema,
  historyPromptSchema,
  indexHealthSchema,
  PROMPT_HISTORY_CHARS_MAX,
  PROMPT_HISTORY_LIMIT_MAX,
  PROMPT_HISTORY_WINDOW_MAX,
  type FindMatch,
} from './api-schemas.js'
import { strictStandardSchema } from './schema.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const renderFind = (output: { readonly ownsService: boolean; readonly matches: readonly FindMatch[]; readonly hasMore: boolean }): string => {
  if (!output.ownsService) return 'The owned session-search index does not serve this profile, so the thread cannot be searched.'
  if (output.matches.length === 0) return 'No event of that thread matches.'
  const lines = output.matches.map(match => `seq ${String(match.seq)} · ${match.type} · ${match.snippet}`)
  return [...lines, ...(output.hasMore ? ['More matches exist: raise `limit` or narrow `text`.'] : [])].join('\n')
}

const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) =>
  defineMethod({
    ...options,
    input: strictStandardSchema(options.input),
    output: strictStandardSchema(options.output),
  })

/**
 * What this plugin adds on top of `sessionQuery` search: the state of its own derived index, and a find over one
 * whole thread in transcript order (the Chat find bar). Every method is a read, and each carries the matching agent tool.
 */
export const sessionSearchApi = defineApi({
  id: 'session-search',
  version: 1,
  owner: '@dshfiles/session-search',
  methods: {
    health: method({
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({ ...indexHealthSchema.fields, ownsService: Schema.Boolean }),
      description:
        'Read the owned session-search index health: indexed sessions and documents, index bytes, how many log sessions and bytes are still behind, whether an ingest pass is running, how long the last pass took, and the last error. `ownsService` is false when another plugin owns the sessionQuery service, in which case content search runs on that backend and these counters stay zero. Read-only.',
      tool: { name: 'session_search_health', readOnly: true, render: compactJson },
    }),
    findInThread: method({
      input: Schema.Struct({
        sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
        limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(FIND_LIMIT_MAX))),
      }),
      output: Schema.Struct({ ownsService: Schema.Boolean, matches: Schema.Array(findMatchSchema), hasMore: Schema.Boolean }),
      description:
        'Find every event of one DSH thread (Session) whose text contains all words of `text` (the last word may be a prefix), in transcript order: the whole stored transcript, older turns and tool calls and results included (model thinking is not indexed). Each match has its event seq, type, time and a short snippet. `limit` defaults to 200. `ownsService` is false when another plugin owns the sessionQuery service and this index is not built. Read-only.',
      tool: { name: 'thread_find', readOnly: true, render: renderFind },
    }),
    // Added after the first release: a Host started before it answers with an unknown-endpoint error.
    promptHistory: method({
      input: Schema.Struct({
        text: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
        limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(PROMPT_HISTORY_LIMIT_MAX)),
        window: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(PROMPT_HISTORY_WINDOW_MAX)),
        maxChars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(PROMPT_HISTORY_CHARS_MAX)),
      }),
      output: Schema.Struct({ ownsService: Schema.Boolean, prompts: Schema.Array(historyPromptSchema) }),
      description:
        'The prompts people sent across every top-level thread, newest first, each text once: only the newest `window` prompts no longer than `maxChars` characters, narrowed to those containing every word of `text` when given. Subagent threads and messages sent by a plugin or agent are left out. Read-only.',
      readOnly: true,
    }),
  },
})
