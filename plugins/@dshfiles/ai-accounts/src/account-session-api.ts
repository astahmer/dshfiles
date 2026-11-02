import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { accountRouteSlugSchema } from './account-draft.js'
import { method } from './api-schema.js'

const accountInput = Schema.Struct({ instanceId: accountRouteSlugSchema })
export const accountSessionCapabilitySchema = Schema.Struct({
  instanceId: accountRouteSlugSchema,
  available: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  credentialScope: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
})
export type AccountSessionCapability = typeof accountSessionCapabilitySchema.Type

/** Credential metadata only. The saved profile, enabled flag and model settings never change. */
export const aiAccountsSessionApi = defineApi({
  id: 'ai-accounts-session',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    capability: method({
      input: accountInput,
      output: accountSessionCapabilitySchema,
      description:
        'Read whether this account can safely sign out and which credential scope it owns. External and shared credential sources report a manual-update reason. Read-only.',
      tool: { name: 'ai_accounts_sign_out_capability', readOnly: true },
    }),
    signOut: method({
      input: Schema.Struct({ ...accountInput.fields, confirm: Schema.Literal(true) }),
      output: Schema.Struct({ signedOut: Schema.Literal(true) }),
      description:
        'Sign out one account by removing only its supported, account-owned credential. Preserve its saved profile, enabled setting and model preferences. Call only when the user asked to sign out; explicit confirm: true is required. Active account connection or sign-in work is refused, never cancelled.',
      tool: { name: 'ai_accounts_sign_out', readOnly: false },
    }),
  },
})
