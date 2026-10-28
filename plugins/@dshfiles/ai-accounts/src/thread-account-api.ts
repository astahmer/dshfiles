import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { accountRouteSlugSchema } from './account-draft.js'

export const threadAccountSelectionSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() }).strict()
const input = z.object({ sessionId: z.string().min(1).optional(), instanceId: accountRouteSlugSchema }).strict()
export const threadAccountPreviewSchema = z
  .object({
    sessionId: z.string(),
    instanceId: accountRouteSlugSchema,
    displayName: z.string(),
    current: threadAccountSelectionSchema,
    target: threadAccountSelectionSchema,
    modelName: z.string(),
    strategy: z.enum(['same-model', 'default-model', 'preferred-model']),
    expectedRevision: z.number().int().nonnegative(),
    running: z.boolean(),
    context: z
      .object({ estimatedTokens: z.number().nonnegative(), targetWindow: z.number().positive().nullable(), suggestCompaction: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict()
export type ThreadAccountPreview = z.infer<typeof threadAccountPreviewSchema>

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
      input: input.extend({ expectedRevision: z.number().int().nonnegative(), target: threadAccountSelectionSchema }).strict(),
      output: threadAccountPreviewSchema,
      description:
        'Use a saved account for one thread’s upcoming requests without changing an in-flight request, other threads or the deployment default. Requires a fresh preview revision and exact target selection. Does not send a message, resume work, compact history, or change account priority. Agents can only switch their own thread. Call only when the user asked to use that account for the thread.',
      tool: { name: 'ai_accounts_switch_thread', readOnly: false },
    }),
  },
})
