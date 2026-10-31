import { Schema } from 'effect'
import { z } from 'zod'

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

export const secretMetadataSchema = z.object({
  id: z.string(),
  alias: z.string(),
  scope: z.string(),
  environment: z.string(),
  variableName: z.string(),
  item: z.string(),
  field: z.string(),
  service: z.string(),
  description: z.string(),
})

export type SecretMetadata = z.infer<typeof secretMetadataSchema>

const rowsFromValidatedOutput = (output: typeof secretPrintRowsSchema.Type) => {
  if (Schema.is(secretPrintRowsArraySchema)(output)) return output
  if ('rows' in output) return output.rows
  if ('items' in output) return output.items
  return output.aliases
}

export const parseSecretPrintMetadata = (jsonText: string, defaultScope = 'unknown'): SecretMetadata[] => {
  const decoded: unknown = JSON.parse(jsonText)
  const rows = rowsFromValidatedOutput(Schema.decodeUnknownSync(secretPrintRowsSchema)(decoded))
  return rows.map(row => {
    const environment = row.environment ?? row.environmentName ?? row.env ?? 'prod'
    const variableName = row.envKey ?? row.env_key ?? row.dotenvKey ?? row.dotenv_key ?? row.alias
    const item = row.item ?? ''
    const field = row.field ?? ''
    return secretMetadataSchema.parse({
      id: JSON.stringify([row.scope ?? defaultScope, row.alias, environment, item, field]),
      alias: row.alias,
      scope: row.scope ?? defaultScope,
      environment,
      variableName: variableName.length > 0 ? variableName : row.alias,
      item,
      field,
      service: row.service ?? row.source ?? item,
      description: row.description ?? row.service ?? row.source ?? item,
    })
  })
}
