import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const accountInput = z.object({ instanceId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u) }).strict()

/** Only validated device instructions cross to the authenticated Web client. No CLI output or credentials. */
export const accountLoginStateSchema = z
  .object({
    instanceId: z.string().max(64),
    status: z.enum(['idle', 'starting', 'waiting', 'complete', 'error', 'cancelled']),
    message: z.string().max(512),
    errorCode: z
      .enum([
        'unsupported',
        'unavailable',
        'unsafe-home',
        'timeout',
        'invalid-output',
        'failed',
        'auth-not-saved',
        'refresh-failed',
        'replace-required',
        'auth-changed',
        'cleanup-failed',
      ])
      .nullable(),
    verificationUri: z.literal('https://auth.openai.com/codex/device').nullable(),
    userCode: z
      .string()
      .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/u)
      .nullable(),
    expiresAt: z.number().nullable(),
  })
  .strict()

export type AccountLoginState = z.infer<typeof accountLoginStateSchema>

/** Device codes are human-only, including when a caller bypasses the tool renderer. */
export const accountLoginMetadata = (state: AccountLoginState): AccountLoginState => ({ ...state, verificationUri: null, userCode: null })
const renderMetadata = (state: AccountLoginState): string => JSON.stringify(accountLoginMetadata(state))

export const aiAccountsLoginApi = defineApi({
  id: 'ai-accounts-login',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    begin: method({
      input: accountInput
        .extend({
          replaceExisting: z.literal(true).optional(),
          operationId: z
            .uuid()
            .transform(value => value.toLowerCase())
            .optional(),
        })
        .strict(),
      output: accountLoginStateSchema,
      description:
        'Start official Codex CLI device sign-in in fresh private staging under an existing account’s shadow home. Call only when the user asked to sign in. Replacing existing credentials requires explicit replaceExisting:true consent; cancellation preserves the existing login. The user completes authorization in the Web GUI; device codes and URLs are excluded from agent output. No auto-install or Claude OAuth.',
      tool: { name: 'ai_accounts_begin_login', readOnly: false, render: renderMetadata },
    }),
    status: method({
      input: accountInput,
      output: accountLoginStateSchema,
      description: 'Read managed account sign-in status. Metadata only for agent callers; the authenticated Web GUI shows the device instructions. Read-only.',
      tool: { name: 'ai_accounts_login_status', readOnly: true, render: renderMetadata },
    }),
    cancel: method({
      input: accountInput
        .extend({
          confirm: z.literal(true),
          operationId: z
            .uuid()
            .transform(value => value.toLowerCase())
            .optional(),
        })
        .strict(),
      output: accountLoginStateSchema,
      description:
        'Cancel the managed Codex sign-in process for an account. Preserves the existing account login until a successful sign-in commits. Call only when the user asked to cancel sign-in; explicit confirm: true is required.',
      tool: { name: 'ai_accounts_cancel_login', readOnly: false, render: renderMetadata },
    }),
  },
})
