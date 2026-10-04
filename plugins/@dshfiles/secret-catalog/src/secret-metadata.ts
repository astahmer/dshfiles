import { z } from 'zod'

const secretPrintRowSchema = z.object({
  alias: z.string().min(1).max(256),
  scope: z.string().max(64).optional(),
  env: z.string().max(256).optional(),
  environment: z.string().max(256).optional(),
  environmentName: z.string().max(256).optional(),
  envKey: z.string().max(256).optional(),
  env_key: z.string().max(256).optional(),
  dotenvKey: z.string().max(256).optional(),
  dotenv_key: z.string().max(256).optional(),
  item: z.string().max(512).optional(),
  field: z.string().max(256).optional(),
  source: z.string().max(2048).optional(),
  service: z.string().max(512).optional(),
  description: z.string().max(1024).optional(),
}).strip()

const secretPrintRowsSchema = z.union([
  z.array(secretPrintRowSchema).max(5000),
  z.object({ rows: z.array(secretPrintRowSchema).max(5000) }).strip(),
  z.object({ items: z.array(secretPrintRowSchema).max(5000) }).strip(),
  z.object({ aliases: z.array(secretPrintRowSchema).max(5000) }).strip(),
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

const rowsFromOutput = (output: unknown): z.infer<typeof secretPrintRowSchema>[] => {
  const rows = secretPrintRowsSchema.parse(output)
  if (Array.isArray(rows)) return rows
  if ('rows' in rows) return rows.rows
  if ('items' in rows) return rows.items
  return rows.aliases
}

export const parseSecretPrintMetadata = (jsonText: string, defaultScope = 'unknown'): SecretMetadata[] => {
  const decoded: unknown = JSON.parse(jsonText)
  return rowsFromOutput(decoded).map(row => {
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
