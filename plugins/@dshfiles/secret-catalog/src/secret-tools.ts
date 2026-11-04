import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { SecretCatalog } from './secret-catalog.js'
import { resolveSecretValue } from './secret-reference-resolver.js'

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

export const secretTools = [secretList, secretGet]
