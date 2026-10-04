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
  readonly options: readonly SettingsOption[]
  readonly target: SettingsSearchTarget
}

export type SettingsOptionValue = string | number | boolean | null

export interface SettingsOption {
  readonly value: SettingsOptionValue
  readonly label: string
}

const recordSchema = z.record(z.string(), z.unknown())
const optionValueSchema = z.union([z.null(), z.string(), z.number().finite(), z.boolean()])

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

const makeSettingOption = (value: unknown, schema: Record<string, unknown> | null): SettingsOption | null => {
  const parsedValue = optionValueSchema.safeParse(value)
  if (!parsedValue.success) return null
  const label = schema === null ? null : schemaText(schema, 'label') ?? schemaText(schema, 'title')
  return { value: parsedValue.data, label: label ?? String(parsedValue.data) }
}

const enumOptions = (record: Record<string, unknown>): readonly SettingsOption[] => {
  if (!Array.isArray(record.enum)) return []
  return record.enum.flatMap(value => {
    const option = makeSettingOption(value, null)
    return option === null ? [] : [option]
  })
}

const literalSchemaOptions = (schema: unknown, depth: number): readonly SettingsOption[] => {
  if (depth > 8) return []
  const record = objectRecord(schema)
  if (record === null) return []
  if (record.type === 'const' && Object.hasOwn(record, 'value')) {
    const option = makeSettingOption(record.value, record)
    return option === null ? [] : [option]
  }
  if (Array.isArray(record.list)) return record.list.flatMap(value => literalSchemaOptions(value, depth + 1))
  return enumOptions(record)
}

const finiteChoiceOptions = (schema: unknown, depth: number): readonly SettingsOption[] | null => {
  if (depth > 8) return null
  const record = objectRecord(schema)
  if (record === null) return null
  if (Array.isArray(record.enum)) return enumOptions(record)
  if (record.type === 'const' && Object.hasOwn(record, 'value')) {
    const option = makeSettingOption(record.value, record)
    return option === null ? null : [option]
  }
  if (record.type !== 'union' || !Array.isArray(record.list) || record.list.length === 0) return null
  const choices = record.list.map(value => finiteChoiceOptions(value, depth + 1))
  if (choices.some(value => value === null)) return null
  return choices.flatMap(value => value ?? [])
}

const uniqueOptions = (options: readonly SettingsOption[]): readonly SettingsOption[] => {
  const seen = new Set<string>()
  return options.filter(option => {
    const key = JSON.stringify([typeof option.value, option.value])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 64)
}

export const settingsSearchOptions = (schema: unknown): readonly SettingsOption[] =>
  uniqueOptions(literalSchemaOptions(schema, 0))

export const settingsChoiceOptions = (schema: unknown): readonly SettingsOption[] =>
  uniqueOptions(finiteChoiceOptions(schema, 0) ?? [])

const normalizeSearchText = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export const settingsNamespaceTitle = (namespace: SettingsSearchNamespace): string => {
  const schema = objectRecord(namespace.schema)
  if (schema === null) return namespace.ns
  return schemaText(schema, 'label') ?? schemaText(schema, 'title') ?? namespace.ns
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
  category: string,
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
    const nested = collectSchemaResults(entryId, fieldSchema, fieldPath, fieldLabels, secrets, category, depth + 1)
    const result: SettingsSearchResult = {
      id: JSON.stringify([entryId, fieldPath]),
      title: label,
      description: schemaText(child, 'description') ?? '',
      context: [...new Set([category, entryId, ...fieldLabels.slice(0, -1)])].join(' · '),
      options: settingsSearchOptions(child),
      target: { entryId, fieldPath },
    }
    return [result, ...nested]
  })
}

export const describeSettingsTargets = (namespaces: readonly SettingsSearchNamespace[]): SettingsSearchResult[] =>
  namespaces.flatMap(namespace => collectSchemaResults(
    namespace.ns,
    namespace.schema,
    [],
    [],
    namespace.secrets ?? [],
    settingsNamespaceTitle(namespace),
    0,
  ))

export const searchSettingsTargets = (
  results: readonly SettingsSearchResult[],
  query: string,
): readonly SettingsSearchResult[] => {
  const term = normalizeSearchText(query.trim())
  if (term.length === 0) return []
  return results.filter(result => normalizeSearchText(
    `${result.title} ${result.description} ${result.context} ${result.options.map(option => `${option.label} ${String(option.value)}`).join(' ')}`,
  ).includes(term))
}
