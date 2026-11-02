import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { accountRouteSlugSchema } from './account-draft.js'
import { method } from './api-schema.js'

const nonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const threadAccountSelectionSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningEffort: Schema.optional(Schema.String),
})
const input = Schema.Struct({ sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1))), instanceId: accountRouteSlugSchema })
export const threadAccountPreviewSchema = Schema.Struct({
  sessionId: Schema.String,
  instanceId: accountRouteSlugSchema,
  displayName: Schema.String,
  current: threadAccountSelectionSchema,
  target: threadAccountSelectionSchema,
  modelName: Schema.String,
  strategy: Schema.Literals(['same-model', 'default-model', 'preferred-model']),
  expectedRevision: nonNegativeInteger,
  running: Schema.Boolean,
  context: Schema.NullOr(
    Schema.Struct({
      estimatedTokens: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
      targetWindow: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
      suggestCompaction: Schema.Boolean,
    }),
  ),
})
export type ThreadAccountPreview = typeof threadAccountPreviewSchema.Type

export const threadAccountApi = defineApi({
  id: 'ai-accounts-thread',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    preview: method({
      input,
      output: threadAccountPreviewSchema,
      description:
        'Preview moving one thread to a saved account: keep its exact model if offered, otherwise use the deployment default model if offered, then the target account’s preferred available model. Context size is an estimate, never promised savings. Agents can only inspect their own thread. Read-only.',
      tool: { name: 'ai_accounts_preview_thread_switch', readOnly: true },
    }),
    switch: method({
      input: Schema.Struct({ ...input.fields, expectedRevision: nonNegativeInteger, target: threadAccountSelectionSchema }),
      output: threadAccountPreviewSchema,
      description:
        'Use a saved account for one thread’s upcoming requests without changing an in-flight request, other threads or the deployment default. Requires a fresh preview revision and exact target selection. Does not send a message, resume work, compact history, or change account priority. Agents can only switch their own thread. Call only when the user asked to use that account for the thread.',
      tool: { name: 'ai_accounts_switch_thread', readOnly: false },
    }),
  },
})
