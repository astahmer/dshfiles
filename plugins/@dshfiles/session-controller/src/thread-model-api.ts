import { defineApi, method, zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const threadModelSelectionSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
})
export type ThreadModelSelection = Schema.Schema.Type<typeof threadModelSelectionSchema>

/** Durable intent only: request headers never clear this preference. */
export const threadModelPolicyEffectSchema = Schema.Struct({
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  selection: Schema.NullOr(threadModelSelectionSchema),
  preferSelectedProvider: Schema.Boolean,
})
export type ThreadModelPolicy = Schema.Schema.Type<typeof threadModelPolicyEffectSchema>
/**
 * The session-projection contract types a projection `stateSchema`/`viewSchema` as `ZodType`, and ai-accounts validates
 * the persisted record with `safeParse`; this view carries the Effect schema across both boundaries.
 */
export const threadModelPolicySchema = zodSchemaFromEffect(threadModelPolicyEffectSchema)

export const threadModelSnapshotSchema = Schema.Struct({
  sessionId: Schema.String,
  selection: threadModelSelectionSchema,
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  running: Schema.Boolean,
  preferSelectedProvider: Schema.Boolean,
})
export type ThreadModelSnapshot = Schema.Schema.Type<typeof threadModelSnapshotSchema>
export const threadModelTargetSchema = Schema.Struct({ sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))) })
export const threadModelSelectSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  selection: threadModelSelectionSchema,
  expectedRevision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  preferSelectedProvider: Schema.Boolean,
})
export type ThreadModelSelect = Schema.Schema.Type<typeof threadModelSelectSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    threadModelPolicy: ThreadModelPolicy
  }
  interface SessionProjectionMap {
    threadModelPolicy: ThreadModelPolicy
  }
}

export const threadModelApi = defineApi({
  id: 'thread-model',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    snapshot: method({
      description:
        'Read one thread’s local model selection without activating it. Agents may omit sessionId and can read only their own thread; UI and Host callers must provide it. Read-only.',
      input: threadModelTargetSchema,
      output: threadModelSnapshotSchema,
      tool: { name: 'thread_local_model_state', readOnly: true },
    }),
    select: method({
      description:
        'Select a model for this thread’s upcoming requests without changing an in-flight request or the global default. Call only when the user asks. Requires the latest selection revision and an empty waking queue. Agents may target only their own thread; UI and Host callers must provide sessionId.',
      input: threadModelSelectSchema,
      output: threadModelSnapshotSchema,
      tool: { name: 'thread_select_local_model' },
    }),
  },
})
