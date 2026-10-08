import type { ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@dshfiles/dshx/host'
import type { SecretCatalogOperations, SecretScope } from './secret-operations.js'

const listOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cwd: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    aliases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          alias: { type: 'string' },
          scope: { type: 'string' },
          environment: { type: 'string' },
          variableName: { type: 'string' },
          item: { type: 'string' },
          field: { type: 'string' },
        },
      },
    },
  },
} satisfies ValueSchemaSpec

const getOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { alias: { type: 'string' }, environment: { type: 'string' }, value: { type: 'string' } },
} satisfies ValueSchemaSpec

const sessionCwd = (exec: ToolRunContext): string | null => {
  const cwd = exec.agent?.session.header.cwd
  return cwd === undefined || cwd.length === 0 ? null : cwd
}

const isMutableScope = (scope: string): scope is SecretScope => scope === 'global' || scope === 'project' || scope === 'local'

/** Agent tools bound to the calling Session's workspace; `operations` resolves the live Host CLI runner. */
export const createSecretTools = (operations: () => SecretCatalogOperations) => [
  defineTool({
    name: 'secret_list',
    description:
      'List configured secret aliases and metadata for this Session workspace (project, global, and machine-local scopes). Never returns values. Use it before asking the user to configure a credential.',
    parameters: {},
    output: {
      schema: listOutputSchema,
      render: (_args, value) => [
        {
          type: 'text',
          text:
            (value.aliases ?? []).length === 0
              ? 'No secret aliases are configured for this workspace.'
              : (value.aliases ?? [])
                  .map(row => `${row.variableName ?? row.alias} — alias ${row.alias} · ${row.scope} · ${row.environment}${row.item ? ` · ${row.item}` : ''}`)
                  .join('\n'),
        },
      ],
    },
    execute: async (_args, exec) => {
      const cwd = sessionCwd(exec)
      const rows = await operations().list(cwd)
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
    },
  }),
  defineTool({
    name: 'secret_get',
    description:
      'Retrieve one configured secret value from the secret CLI for this Session workspace. The plaintext enters the conversation, so call it only when the current task needs that exact value. Discover aliases with secret_list first.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Configured secret alias, as returned by secret_list.' },
      environment: { type: 'string', description: 'Secret environment; defaults to prod.' },
    },
    output: {
      schema: getOutputSchema,
      render: (_args, value) => [{ type: 'text', text: value.value ?? '' }],
    },
    execute: async (args, exec) => {
      const cwd = sessionCwd(exec)
      const environment = args.environment ?? 'prod'
      const rows = await operations().list(cwd)
      const matches = rows.filter(row => row.alias === args.alias && row.environment === environment)
      const row = matches[0]
      if (row === undefined) throw new Error(`No secret alias ${args.alias} is configured for environment ${environment}.`)
      if (matches.length > 1) throw new Error(`Alias ${args.alias} exists in several scopes; resolve the duplicate with the secret CLI first.`)
      const scope = isMutableScope(row.scope) ? row.scope : 'project'
      const value = await operations().reveal(row.alias, scope, cwd, environment)
      return { alias: row.alias, environment, value }
    },
  }),
]
