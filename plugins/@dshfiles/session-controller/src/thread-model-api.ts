import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadModelSelectionSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
  })
  .strict()
export type ThreadModelSelection = z.infer<typeof threadModelSelectionSchema>

/** Durable intent only: request headers never clear this preference. */
export const threadModelPolicySchema = z
  .object({
    revision: z.number().int().nonnegative().safe(),
    selection: threadModelSelectionSchema.nullable(),
    preferSelectedProvider: z.boolean(),
  })
  .strict()
export type ThreadModelPolicy = z.infer<typeof threadModelPolicySchema>

export const threadModelSnapshotSchema = z
  .object({
    sessionId: z.string(),
    selection: threadModelSelectionSchema,
    revision: z.number().int().nonnegative().safe(),
    running: z.boolean(),
    preferSelectedProvider: z.boolean(),
  })
  .strict()
export type ThreadModelSnapshot = z.infer<typeof threadModelSnapshotSchema>
export const threadModelTargetSchema = z.object({ sessionId: z.string().min(1).max(256).optional() }).strict()
export const threadModelSelectSchema = threadModelTargetSchema
  .extend({
    selection: threadModelSelectionSchema,
    expectedRevision: z.number().int().nonnegative().safe(),
    preferSelectedProvider: z.boolean(),
  })
  .strict()
export type ThreadModelSelect = z.infer<typeof threadModelSelectSchema>

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
