import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { accountRouteSlugSchema } from './account-draft.js'

const accountInput = z.object({ instanceId: accountRouteSlugSchema }).strict()
export const accountSessionCapabilitySchema = z
  .object({
    instanceId: accountRouteSlugSchema,
    available: z.boolean(),
    reason: z.string().max(512).nullable(),
    credentialScope: z.string().max(4096).nullable(),
  })
  .strict()
export type AccountSessionCapability = z.infer<typeof accountSessionCapabilitySchema>

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
      input: accountInput.extend({ confirm: z.literal(true) }).strict(),
      output: z.object({ signedOut: z.literal(true) }).strict(),
      description:
        'Sign out one account by removing only its supported, account-owned credential. Preserve its saved profile, enabled setting and model preferences. Call only when the user asked to sign out; explicit confirm: true is required. Active account connection or sign-in work is refused, never cancelled.',
      tool: { name: 'ai_accounts_sign_out', readOnly: false },
    }),
  },
})
