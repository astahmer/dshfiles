import { DEFAULT_SECRET_ENVIRONMENT } from '@dshfiles/credential-port'
import { secretAliasSchemaEffect, secretEnvironmentSchemaEffect, secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { SecretCatalog } from './secret-catalog.js'
import { resolveSecretValue } from './secret-reference-resolver.js'
import { DEFAULT_SECRET_REQUEST_TIMEOUT_MS, SecretRequests, type SecretRequestOutcome } from './secret-requests.js'

const sessionCwd = (call: Tool.ToolCall): string | null => {
  const cwd = call.agent?.session.header.cwd
  return cwd === undefined || cwd.length === 0 ? null : cwd
}

const listOutput = Schema.Struct({
  cwd: Schema.NullOr(Schema.String),
  aliases: Schema.Array(
    Schema.Struct({
      alias: Schema.String,
      scope: Schema.String,
      environment: Schema.String,
      variableName: Schema.String,
      item: Schema.String,
      field: Schema.String,
    }),
  ),
})

const getOutput = Schema.Struct({ alias: Schema.String, environment: Schema.String, value: Schema.String })

const secretList = Tool.make({
  name: 'secret_list',
  description:
    'List configured secret aliases and metadata for this Session workspace (project, global, and machine-local scopes). Never returns values. Use it before asking the user to configure a credential.',
  input: Schema.Struct({}),
  output: listOutput,
  render: value =>
    value.aliases.length === 0
      ? 'No secret aliases are configured for this workspace.'
      : value.aliases
          .map(row => `${row.variableName || row.alias} — alias ${row.alias} · ${row.scope} · ${row.environment}${row.item ? ` · ${row.item}` : ''}`)
          .join('\n'),
  execute: Effect.fn('secret tool list')(function* (_input, call) {
    const cwd = sessionCwd(call)
    const rows = yield* SecretCatalog.use(catalog => catalog.list(cwd))
    return {
      cwd,
      aliases: rows.map(row => ({
        alias: row.alias,
        scope: row.scope,
        environment: row.environment,
        variableName: row.variableName,
        item: row.item,
        field: row.field,
      })),
    }
  }),
})

const secretGet = Tool.make({
  name: 'secret_get',
  description:
    'Retrieve one configured secret value from the secret CLI for this Session workspace. The plaintext enters the conversation, so call it only when the current task needs that exact value. Discover aliases with secret_list first.',
  input: Schema.Struct({
    alias: Schema.String.annotate({ description: 'Configured secret alias, as returned by secret_list.' }),
    environment: Schema.optionalKey(Schema.String.annotate({ description: 'Secret environment; defaults to prod.' })),
  }),
  output: getOutput,
  render: value => value.value,
  execute: Effect.fn('secret tool get')(function* (input, call) {
    const environment = input.environment ?? 'prod'
    const value = yield* resolveSecretValue({ reference: { alias: input.alias, environment }, cwd: sessionCwd(call) })
    return { alias: input.alias, environment, value }
  }),
})

const requestOutput = Schema.Union([
  Schema.Struct({ status: Schema.Literal('stored'), reference: Schema.String }),
  Schema.Struct({ status: Schema.Literals(['declined', 'expired', 'cancelled']) }),
])

const renderOutcome = (outcome: SecretRequestOutcome): string => {
  if (outcome.status === 'stored')
    return `The user stored the secret. Use the reference ${outcome.reference} wherever a credential reference is accepted; the value was not shared with you.`
  if (outcome.status === 'declined') return 'The user declined to store this secret. Do not ask again unless the user brings it up.'
  if (outcome.status === 'expired') return 'Nobody answered the secret request before it expired; nothing was stored.'
  return 'The secret request was cancelled before the user answered; nothing was stored.'
}

const requestSecret = Tool.make({
  name: 'request_secret',
  description:
    'Ask the user to store a secret value under an alias in the Secret Catalog. The user types the value into a masked Secret Catalog form in this thread, never into chat, and the value is never returned to you. Waits for the answer and returns only the secret:ALIAS[@env] reference once stored, or a declined, expired or cancelled result. Check secret_list first: an alias that already exists does not need a request.',
  input: Schema.Struct({
    alias: secretAliasSchemaEffect.annotate({ description: 'Alias to store the value under, e.g. OPENAI_API_KEY.' }),
    purpose: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)).annotate({
      description: 'One sentence shown to the user: what the secret is and what you will use it for.',
    }),
    environment: Schema.optionalKey(secretEnvironmentSchemaEffect.annotate({ description: 'Secret environment; defaults to prod.' })),
    scope: Schema.optionalKey(
      secretScopeSchemaEffect.annotate({
        description: 'global (default, usable from any folder), project (.secret.json of this thread folder) or local (.secret.local.json).',
      }),
    ),
    timeoutMs: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 10_000, maximum: 3_600_000 })).annotate({
        description: 'How long to wait for the user, 10,000 to 3,600,000 ms; defaults to 600,000.',
      }),
    ),
  }),
  output: requestOutput,
  render: renderOutcome,
  execute: Effect.fn('secret tool request')(function* (input, call) {
    const requests = yield* SecretRequests
    return yield* requests.ask({
      sessionId: call.sessionId ?? null,
      alias: input.alias,
      purpose: input.purpose,
      environment: input.environment ?? DEFAULT_SECRET_ENVIRONMENT,
      scope: input.scope ?? 'global',
      cwd: sessionCwd(call),
      timeoutMs: input.timeoutMs ?? DEFAULT_SECRET_REQUEST_TIMEOUT_MS,
    })
  }),
})

const secretRemoveAlias = Tool.make({
  name: 'secret_remove_alias',
  description:
    'Remove one alias from its own config (global, or this thread folder for project/local), keeping the Bitwarden item it points to. Run only when the user asked to remove that alias, and pass confirm: true. Re-add it with request_secret or the Secret Catalog.',
  input: Schema.Struct({
    alias: secretAliasSchemaEffect.annotate({ description: 'Alias to remove, as listed by secret_list.' }),
    scope: secretScopeSchemaEffect.annotate({ description: 'The scope secret_list reports for that alias.' }),
    confirm: Schema.Literal(true).annotate({ description: 'Must be true: the alias stops resolving for every consumer.' }),
  }),
  output: Schema.Struct({ removed: Schema.Literal(true), alias: Schema.String, scope: Schema.String }),
  render: value => `Removed alias ${value.alias} from its ${value.scope} config; its vault item was kept.`,
  execute: Effect.fn('secret tool remove alias')(function* (input, call) {
    yield* SecretCatalog.use(catalog => catalog.removeAlias({ alias: input.alias, scope: input.scope, cwd: input.scope === 'global' ? null : sessionCwd(call) }))
    return { removed: true, alias: input.alias, scope: input.scope } as const
  }),
})

export const secretTools = [secretList, secretGet, requestSecret, secretRemoveAlias]
