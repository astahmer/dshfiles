import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { method } from './api-schema.js'
import { AiAccountsSchema } from './effect-schema.js'

const nonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const routeFields = {
  sessionId: AiAccountsSchema.id(128),
  accountId: AiAccountsSchema.id(128),
  provider: AiAccountsSchema.id(128),
  model: AiAccountsSchema.id(256),
  turn: nonNegativeInteger,
  step: nonNegativeInteger,
  startedAt: nonNegativeInteger,
  updatedAt: nonNegativeInteger,
}
export const successfulAccountSchema = Schema.Struct({ ...routeFields, status: Schema.Literal('succeeded') })
export const accountAttemptSchema = Schema.Struct({ ...routeFields, status: Schema.Literals(['attempting', 'succeeded', 'failed']) })
export const servingAccountSnapshotSchema = Schema.Struct({
  sessionId: routeFields.sessionId,
  currentAttempt: Schema.NullOr(accountAttemptSchema),
  lastSuccessful: Schema.NullOr(successfulAccountSchema),
})
export type AccountAttempt = typeof accountAttemptSchema.Type
export type SuccessfulAccount = typeof successfulAccountSchema.Type
export type ServingAccountSnapshot = typeof servingAccountSnapshotSchema.Type

export const servingAccountApi = defineApi({
  id: 'ai-accounts-serving-account',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    snapshot: method({
      input: Schema.Struct({ sessionId: Schema.optional(routeFields.sessionId) }),
      output: servingAccountSnapshotSchema,
      description:
        'Read the actual current account attempt and last successful account for one chat. Attempts are ephemeral; only successful main account requests are retained (90 days, at most 2000 chats). Excludes side requests, native requests, chat content and credentials. Agent callers may omit sessionId and may only read their own Session; authenticated UI/Host callers must provide it. Read-only.',
      tool: { name: 'ai_accounts_serving_account', readOnly: true, render: output => JSON.stringify(output) },
    }),
  },
})
