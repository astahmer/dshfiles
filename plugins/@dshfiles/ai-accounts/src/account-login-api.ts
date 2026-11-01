import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import { method } from './api-schema.js'

const accountInput = Schema.Struct({ instanceId: Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u)) })

const lowercasedUuidSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
)

/** Only validated device instructions cross to the authenticated Web client. No CLI output or credentials. */
export const accountLoginStateSchema = Schema.Struct({
  instanceId: Schema.String.check(Schema.isMaxLength(64)),
  status: Schema.Literals(['idle', 'starting', 'waiting', 'complete', 'error', 'cancelled']),
  message: Schema.String.check(Schema.isMaxLength(512)),
  errorCode: Schema.NullOr(
    Schema.Literals([
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
    ]),
  ),
  verificationUri: Schema.NullOr(Schema.Literal('https://auth.openai.com/codex/device')),
  userCode: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/u))),
  expiresAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
})

export type AccountLoginState = typeof accountLoginStateSchema.Type

/** Device codes are human-only, including when a caller bypasses the tool renderer. */
export const accountLoginMetadata = (state: AccountLoginState): AccountLoginState => ({ ...state, verificationUri: null, userCode: null })
const renderMetadata = (state: AccountLoginState): string => JSON.stringify(accountLoginMetadata(state))

export const aiAccountsLoginApi = defineApi({
  id: 'ai-accounts-login',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    begin: method({
      input: Schema.Struct({
        ...accountInput.fields,
        replaceExisting: Schema.optional(Schema.Literal(true)),
        operationId: Schema.optional(lowercasedUuidSchema),
      }),
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
      input: Schema.Struct({
        ...accountInput.fields,
        confirm: Schema.Literal(true),
        operationId: Schema.optional(lowercasedUuidSchema),
      }),
      output: accountLoginStateSchema,
      description:
        'Cancel the managed Codex sign-in process for an account. Preserves the existing account login until a successful sign-in commits. Call only when the user asked to cancel sign-in; explicit confirm: true is required.',
      tool: { name: 'ai_accounts_cancel_login', readOnly: false, render: renderMetadata },
    }),
  },
})
