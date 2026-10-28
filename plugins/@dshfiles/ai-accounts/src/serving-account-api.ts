import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const routeFields = {
  sessionId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128),
  provider: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}
export const successfulAccountSchema = z.object({ ...routeFields, status: z.literal('succeeded') }).strict()
export const accountAttemptSchema = z.object({ ...routeFields, status: z.enum(['attempting', 'succeeded', 'failed']) }).strict()
export const servingAccountSnapshotSchema = z
  .object({
    sessionId: routeFields.sessionId,
    currentAttempt: accountAttemptSchema.nullable(),
    lastSuccessful: successfulAccountSchema.nullable(),
  })
  .strict()
export type AccountAttempt = z.infer<typeof accountAttemptSchema>
export type SuccessfulAccount = z.infer<typeof successfulAccountSchema>
export type ServingAccountSnapshot = z.infer<typeof servingAccountSnapshotSchema>

export const servingAccountApi = defineApi({
  id: 'ai-accounts-serving-account',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    snapshot: method({
      input: z.object({ sessionId: routeFields.sessionId.optional() }).strict(),
      output: servingAccountSnapshotSchema,
      description:
        'Read the actual current account attempt and last successful account for one chat. Attempts are ephemeral; only successful main account requests are retained (90 days, at most 2000 chats). Excludes side requests, native requests, chat content and credentials. Agent callers may omit sessionId and may only read their own Session; authenticated UI/Host callers must provide it. Read-only.',
      tool: { name: 'ai_accounts_serving_account', readOnly: true, render: output => JSON.stringify(output) },
    }),
  },
})
