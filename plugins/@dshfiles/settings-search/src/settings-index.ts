import { z } from 'zod'

/** Keep this structural target local so the plugin builds with older client typings. */
export interface SettingsSearchTarget {
  readonly entryId: string
  readonly fieldPath: readonly string[]
}

export type SettingsTargetOpener = (target: SettingsSearchTarget) => boolean

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
  const label = schema === null ? null : (schemaText(schema, 'label') ?? schemaText(schema, 'title'))
  return { value: parsedValue.data, label: label ?? String(parsedValue.data) }
}

const enumOptions = (record: Record<string, unknown>): readonly SettingsOption[] => {
  if (!Array.isArray(record.enum)) return []
  return record.enum.flatMap(value => {
    const option = makeSettingOption(value, null)
    return option === null ? [] : [option]
  })
}

/**
 * Literal choices reachable from one already-resolved node.
 *
 * A union's `list` holds branch *uids*, so each branch is resolved through the
 * refs table before it is inspected. Bounds stay finite: a self-referential
 * schema cannot walk forever.
 */
const literalSchemaOptions = (schema: SerializedSchema, node: Record<string, unknown>, depth: number): readonly SettingsOption[] => {
  if (depth > 8) return []
  if (node.type === 'const' && Object.hasOwn(node, 'value')) {
    const option = makeSettingOption(node.value, node)
    return option === null ? [] : [option]
  }
  const branches = unionBranches(node)
  if (branches === null) return enumOptions(node)
  return branches.flatMap(reference => {
    const branch = schemaNode(schema, reference)
    return branch === null ? [] : literalSchemaOptions(schema, branch, depth + 1)
  })
}

/** Choices for a field node, or null when the field is not a finite choice. */
const finiteChoiceOptions = (schema: SerializedSchema, node: Record<string, unknown>, depth: number): readonly SettingsOption[] | null => {
  if (depth > 8) return null
  if (Array.isArray(node.enum)) return enumOptions(node)
  if (node.type === 'const' && Object.hasOwn(node, 'value')) {
    const option = makeSettingOption(node.value, node)
    return option === null ? null : [option]
  }
  const branches = unionBranches(node)
  if (branches === null || node.type !== 'union' || branches.length === 0) return null
  const choices = branches.map(reference => {
    const branch = schemaNode(schema, reference)
    return branch === null ? null : finiteChoiceOptions(schema, branch, depth + 1)
  })
  if (choices.some(value => value === null)) return null
  return choices.flatMap(value => value ?? [])
}

const uniqueOptions = (options: readonly SettingsOption[]): readonly SettingsOption[] => {
  const seen = new Set<string>()
  return options
    .filter(option => {
      const key = JSON.stringify([typeof option.value, option.value])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 64)
}

/**
 * Choices for a schema node resolved from a serialized schema.
 *
 * A caller holding only a node cannot resolve its union branches without the
 * refs table, so a branch list of bare uids degrades to no choices rather than
 * to a wrong list.
 */
const choicesForNode = (node: unknown): readonly SettingsOption[] => {
  const record = objectRecord(node)
  if (record === null) return []
  const branches = unionBranches(record)
  if (branches === null || branches.length === 0) return uniqueOptions(finiteChoiceOptions(EMPTY_SERIALIZED_SCHEMA, record, 0) ?? [])
  if (branches.every(reference => objectRecord(reference) !== null)) {
    return uniqueOptions(finiteChoiceOptions(EMPTY_SERIALIZED_SCHEMA, record, 0) ?? [])
  }
  return []
}

const EMPTY_SERIALIZED_SCHEMA: SerializedSchema = { uid: 0, refs: {} }

export const settingsSearchOptions = (node: unknown): readonly SettingsOption[] => choicesForNode(node)

export const settingsChoiceOptions = (node: unknown): readonly SettingsOption[] => choicesForNode(node)

/**
 * A serialized schemastery schema, as `settings.describe` sends it.
 *
 * The wire carries `schema.toJSON()`: a `refs` table keyed by numeric uid, where
 * `uid` names the root node, an object node's `dict` maps field name to that
 * field's uid, and a union node's `list` names its branches. A child is therefore
 * an integer reference, never an inline node.
 *
 * These helpers resolve one reference to its node and expose the two containers
 * the walk needs. They deliberately accept either a resolved node or a bare uid
 * so callers can pass a node they already hold without re-resolving it.
 */
interface SerializedSchema {
  readonly uid: number
  readonly refs: Readonly<Record<string, unknown>>
}

const serializedSchema = (value: unknown): SerializedSchema | null => {
  const record = objectRecord(value)
  if (record === null) return null
  if (!Number.isInteger(record.uid)) return null
  const refs = objectRecord(record.refs)
  if (refs === null) return null
  return { uid: record.uid as number, refs }
}

const schemaNode = (schema: SerializedSchema, reference: unknown): Record<string, unknown> | null => {
  if (objectRecord(reference) !== null) return reference as Record<string, unknown>
  if (typeof reference !== 'number' || !Number.isInteger(reference)) return null
  return objectRecord(schema.refs[String(reference)])
}

/** An object node's field name → uid map, or null when the node is not an object. */
const dictFields = (node: Record<string, unknown>): Record<string, unknown> | null => objectRecord(node.dict)

/** A union node's branch uids, or null when the node is not a union. */
const unionBranches = (node: Record<string, unknown>): readonly unknown[] | null => (Array.isArray(node.list) ? node.list : null)

const nodeLabel = (node: Record<string, unknown>): string | null => schemaText(node, 'label') ?? schemaText(node, 'title')

/** Ceiling on indexed settings, so a large Host cannot make the walk unbounded. */
const MAX_INDEXED_SETTINGS = 2000

const normalizeSearchText = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export const settingsNamespaceTitle = (namespace: SettingsSearchNamespace): string => {
  const schema = serializedSchema(namespace.schema)
  if (schema === null) return namespace.ns
  const root = schemaNode(schema, schema.uid)
  if (root === null) return namespace.ns
  return nodeLabel(root) ?? namespace.ns
}

const overlapsSecretPath = (path: readonly string[], secrets: readonly SettingsSecretPath[]): boolean =>
  secrets.some(secret => {
    const sharedLength = Math.min(secret.path.length, path.length)
    return sharedLength > 0 && secret.path.slice(0, sharedLength).every((segment, index) => path[index] === segment)
  })

const collectSchemaResults = (
  entryId: string,
  schema: SerializedSchema,
  node: Record<string, unknown>,
  path: readonly string[],
  labels: readonly string[],
  secrets: readonly SettingsSecretPath[],
  category: string,
  depth: number,
): SettingsSearchResult[] => {
  if (depth > 8) return []
  const fields = dictFields(node)
  if (fields === null) return []
  return Object.entries(fields).flatMap(([fieldName, fieldReference]) => {
    const fieldPath = [...path, fieldName]
    if (overlapsSecretPath(fieldPath, secrets)) return []
    const child = schemaNode(schema, fieldReference)
    if (child === null) return []
    const label = nodeLabel(child) ?? fieldName
    const fieldLabels = [...labels, label]
    // Descend from the field's own node, never from the root: re-reading the
    // root uid here would restart the walk at the top of the schema for every
    // object-valued field and expand paths without bound.
    const nested = collectSchemaResults(entryId, schema, child, fieldPath, fieldLabels, secrets, category, depth + 1)
    const result: SettingsSearchResult = {
      id: JSON.stringify([entryId, fieldPath]),
      title: label,
      description: schemaText(child, 'description') ?? '',
      context: [...new Set([category, entryId, ...fieldLabels.slice(0, -1)])].join(' · '),
      options: literalSchemaOptions(schema, child, 0),
      target: { entryId, fieldPath },
    }
    return [result, ...nested]
  })
}

export const describeSettingsTargets = (namespaces: readonly SettingsSearchNamespace[]): SettingsSearchResult[] => {
  const results: SettingsSearchResult[] = []
  for (const namespace of namespaces) {
    const schema = serializedSchema(namespace.schema)
    if (schema === null) continue
    const root = schemaNode(schema, schema.uid)
    if (root === null) continue
    results.push(...collectSchemaResults(namespace.ns, schema, root, [], [], namespace.secrets ?? [], settingsNamespaceTitle(namespace), 0))
    // A Host can register many namespaces; the index is a search aid, not a
    // registry, so it stops adding once the browse and query views are full.
    if (results.length >= MAX_INDEXED_SETTINGS) break
  }
  return results
}

const searchRank = (result: SettingsSearchResult, term: string): number => {
  const title = normalizeSearchText(result.title)
  if (title === term) return 0
  if (title.startsWith(term)) return 1
  if (title.includes(term)) return 2
  if (normalizeSearchText(result.context).includes(term)) return 3
  const rest = normalizeSearchText(`${result.description} ${result.options.map(option => `${option.label} ${String(option.value)}`).join(' ')}`)
  return rest.includes(term) ? 4 : -1
}

/** Title matches outrank section and description matches, as in the BB settings search. */
export const searchSettingsTargets = (results: readonly SettingsSearchResult[], query: string): readonly SettingsSearchResult[] => {
  const term = normalizeSearchText(query.trim())
  if (term.length === 0) return []
  return results
    .map(result => ({ result, rank: searchRank(result, term) }))
    .filter(entry => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank)
    .map(entry => entry.result)
}
