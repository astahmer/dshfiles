import { Effect, Schema } from 'effect'

const boundedString = (maxLength: number) => Schema.String.check(Schema.isMaxLength(maxLength))
const secretPrintRowSchema = Schema.Struct({
  alias: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  scope: boundedString(64).pipe(Schema.optional),
  env: boundedString(256).pipe(Schema.optional),
  environment: boundedString(256).pipe(Schema.optional),
  environmentName: boundedString(256).pipe(Schema.optional),
  envKey: boundedString(256).pipe(Schema.optional),
  env_key: boundedString(256).pipe(Schema.optional),
  dotenvKey: boundedString(256).pipe(Schema.optional),
  dotenv_key: boundedString(256).pipe(Schema.optional),
  item: boundedString(512).pipe(Schema.optional),
  field: boundedString(256).pipe(Schema.optional),
  source: boundedString(2048).pipe(Schema.optional),
  service: boundedString(512).pipe(Schema.optional),
  description: boundedString(1024).pipe(Schema.optional),
})
const secretPrintRowsArraySchema = Schema.Array(secretPrintRowSchema).check(Schema.isMaxLength(5000))
const secretPrintRowsSchema = Schema.Union([
  secretPrintRowsArraySchema,
  Schema.Struct({ rows: secretPrintRowsArraySchema }),
  Schema.Struct({ items: secretPrintRowsArraySchema }),
  Schema.Struct({ aliases: secretPrintRowsArraySchema }),
])

export const secretMetadataSchema = Schema.Struct({
  id: Schema.String,
  alias: Schema.String,
  scope: Schema.String,
  environment: Schema.String,
  variableName: Schema.String,
  item: Schema.String,
  field: Schema.String,
  service: Schema.String,
  description: Schema.String,
})

export type SecretMetadata = typeof secretMetadataSchema.Type

const rowsFromValidatedOutput = (output: typeof secretPrintRowsSchema.Type) => {
  if (Schema.is(secretPrintRowsArraySchema)(output)) return output
  if ('rows' in output) return output.rows
  if ('items' in output) return output.items
  return output.aliases
}

const decodePrintOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(secretPrintRowsSchema))

/** Value-free metadata from `secret print --json`; a value field the CLI prints is never kept. */
export const decodeSecretPrintMetadata = (input: { readonly jsonText: string; readonly defaultScope: string }) =>
  Effect.map(decodePrintOutput(input.jsonText), output =>
    rowsFromValidatedOutput(output).map((row): SecretMetadata => {
      const environment = row.environment ?? row.environmentName ?? row.env ?? 'prod'
      const variableName = row.envKey ?? row.env_key ?? row.dotenvKey ?? row.dotenv_key ?? row.alias
      const item = row.item ?? ''
      const field = row.field ?? ''
      return {
        id: JSON.stringify([row.scope ?? input.defaultScope, row.alias, environment, item, field]),
        alias: row.alias,
        scope: row.scope ?? input.defaultScope,
        environment,
        variableName: variableName.length > 0 ? variableName : row.alias,
        item,
        field,
        service: row.service ?? row.source ?? item,
        description: row.description ?? row.service ?? row.source ?? item,
      }
    }),
  )
