import { z } from 'zod'

export interface SettingsSearchTarget {
  readonly entryId: string
  readonly fieldPath: readonly string[]
}

export interface SettingsSecretPath {
  readonly path: readonly string[]
  readonly set: boolean
}

export interface SettingsSearchNamespace {
  readonly ns: string
  readonly schema: unknown
  readonly secrets?: readonly SettingsSecretPath[]
}

export interface SettingsSearchResult {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly context: string
  readonly target: SettingsSearchTarget
}

const recordSchema = z.record(z.string(), z.unknown())

export const objectRecord = (value: unknown): Record<string, unknown> | null => {
  const result = recordSchema.safeParse(value)
  return result.success ? result.data : null
}

const textField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const schemaText = (record: Record<string, unknown>, key: string): string | null => {
  const direct = textField(record, key)
  if (direct !== null) return direct
  const metadata = objectRecord(record.meta)
  if (metadata === null) return null
  return textField(metadata, key)
}

const fieldMap = (record: Record<string, unknown>): Record<string, unknown> | null =>
  objectRecord(record.fields) ?? objectRecord(record.properties)

const overlapsSecretPath = (path: readonly string[], secrets: readonly SettingsSecretPath[]): boolean =>
  secrets.some(secret => {
    const sharedLength = Math.min(secret.path.length, path.length)
    return sharedLength > 0 && secret.path.slice(0, sharedLength).every((segment, index) => path[index] === segment)
  })

const collectSchemaResults = (
  entryId: string,
  schema: unknown,
  path: readonly string[],
  labels: readonly string[],
  secrets: readonly SettingsSecretPath[],
  depth: number,
): SettingsSearchResult[] => {
  if (depth > 8) return []
  const record = objectRecord(schema)
  if (record === null) return []
  const fields = fieldMap(record)
  if (fields === null) return []
  return Object.entries(fields).flatMap(([fieldName, fieldSchema]) => {
    const fieldPath = [...path, fieldName]
    if (overlapsSecretPath(fieldPath, secrets)) return []
    const child = objectRecord(fieldSchema)
    if (child === null) return []
    const label = schemaText(child, 'label') ?? schemaText(child, 'title') ?? fieldName
    const fieldLabels = [...labels, label]
    const nested = collectSchemaResults(entryId, fieldSchema, fieldPath, fieldLabels, secrets, depth + 1)
    const result: SettingsSearchResult = {
      id: JSON.stringify([entryId, fieldPath]),
      title: label,
      description: schemaText(child, 'description') ?? '',
      context: [entryId, ...fieldLabels.slice(0, -1)].join(' · '),
      target: { entryId, fieldPath },
    }
    return [result, ...nested]
  })
}

export const describeSettingsTargets = (namespaces: readonly SettingsSearchNamespace[]): SettingsSearchResult[] =>
  namespaces.flatMap(namespace => collectSchemaResults(namespace.ns, namespace.schema, [], [], namespace.secrets ?? [], 0))

export const searchSettingsTargets = (
  results: readonly SettingsSearchResult[],
  query: string,
): readonly SettingsSearchResult[] => {
  const term = query.trim().toLocaleLowerCase()
  if (term.length === 0) return []
  return results.filter(result =>
    `${result.title} ${result.description} ${result.context}`.toLocaleLowerCase().includes(term),
  )
}
