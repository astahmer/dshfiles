import type z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { SettingsClientOptions, SettingsContract, SettingsContribution, SettingsHostContribution, SettingsHostOptions, SettingsValue } from './types.js'

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/
const settingsContracts = new WeakSet<object>()
export interface SettingsHostContributionParts {
  readonly contract: SettingsContract<z<any, object>, any>
  readonly options: SettingsHostOptions<any>
}

const settingsHostContributions = new WeakMap<object, SettingsHostContributionParts>()

// Schemastery's toJSON() is typed as a Schema but returns its serialized graph: nodes keyed by uid, linked by uid.
const serializedSchema = zod.object({
  uid: zod.union([zod.string(), zod.number()]),
  refs: zod.record(zod.string(), zod.looseObject({ type: zod.unknown().optional(), meta: zod.looseObject({ role: zod.unknown().optional() }).optional() })),
})
const referenceSchema = zod.union([zod.string(), zod.number()])
const referenceListSchema = zod.array(zod.unknown()).transform(values =>
  values.flatMap(value => {
    const reference = referenceSchema.safeParse(value)
    return reference.success ? [String(reference.data)] : []
  }),
)
const referenceMapSchema = zod.record(zod.string(), zod.unknown()).transform(values =>
  Object.values(values).flatMap(value => {
    const reference = referenceSchema.safeParse(value)
    return reference.success ? [String(reference.data)] : []
  }),
)
const schemaLinks = zod.union([referenceSchema.transform(value => [String(value)]), referenceListSchema, referenceMapSchema])
const SAFE_SECRET_CONTAINERS = new Set(['object', 'dict', 'array'])

interface SecretAnalysis {
  readonly contains: boolean
  readonly unsafe: boolean
}

function secretAnalysis(schema: z<any, object>): SecretAnalysis {
  const json = serializedSchema.safeParse(schema.toJSON())
  if (!json.success) return { contains: false, unsafe: false }
  const refs = json.data.refs
  const memo = new Map<string, SecretAnalysis>()
  const active = new Set<string>()
  const visit = (id: string): SecretAnalysis => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (active.has(id)) return { contains: false, unsafe: false }
    active.add(id)
    const node = refs[id]
    if (node === undefined) return { contains: false, unsafe: false }
    const direct = node.meta?.role === 'secret'
    const links: string[] = []
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uid' || key === 'meta' || key === 'callback' || key === 'type') continue
      const references = schemaLinks.safeParse(value)
      if (references.success) links.push(...references.data.filter(reference => refs[reference] !== undefined))
    }
    const children = links.map(visit)
    const contains = direct || children.some(child => child.contains)
    const unsafe =
      children.some(child => child.unsafe) ||
      (children.some(child => child.contains) && !SAFE_SECRET_CONTAINERS.has(String(node.type))) ||
      (direct && links.length > 0 && !SAFE_SECRET_CONTAINERS.has(String(node.type)))
    const result = { contains, unsafe }
    memo.set(id, result)
    active.delete(id)
    return result
  }
  return visit(String(json.data.uid))
}

function settingsSchemaContainsSecret(schema: z<any, object>): boolean {
  try {
    return secretAnalysis(schema).contains
  } catch {
    return false
  }
}

function settingsSchemaHasUnsafeSecretPath(schema: z<any, object>): boolean {
  try {
    return secretAnalysis(schema).unsafe
  } catch {
    return true
  }
}

export interface SettingsDefinition<Schema extends z<any, object>, ClientValue extends object = SettingsValue<Schema>> {
  readonly namespace: string
  readonly schema: Schema
  /** DSH 0.2 applies every Settings change live; restart-only options belong in native Config fields. */
  readonly applies?: 'live'
  readonly client?: SettingsClientOptions<ClientValue>
}

function isSettingsContract(value: unknown): value is SettingsContract {
  return typeof value === 'object' && value !== null && settingsContracts.has(value)
}

function isSettingsHostContribution(value: unknown): value is SettingsHostContribution {
  return typeof value === 'object' && value !== null && settingsHostContributions.has(value)
}

function settingsHostContributionParts(value: SettingsHostContribution): SettingsHostContributionParts {
  const parts = settingsHostContributions.get(value)
  if (parts === undefined) throw new TypeError('Invalid Settings Host contribution; create it with contract.host({ ...options }).')
  return parts
}

function settingsContributionContract(value: SettingsContribution): SettingsContract<z<any, object>, any> {
  return isSettingsContract(value) ? value : settingsHostContributionParts(value).contract
}

function defineSettings<const Schema extends z<any, object>>(
  definition: Omit<SettingsDefinition<Schema, SettingsValue<Schema>>, 'client'> & { readonly client?: undefined },
): SettingsContract<Schema, SettingsValue<Schema>>
function defineSettings<const Schema extends z<any, object>, const Decoder extends (value: unknown) => object>(
  definition: Omit<SettingsDefinition<Schema, ReturnType<Decoder>>, 'client'> & {
    readonly client: { readonly decode: Decoder & ((value: unknown) => Exclude<ReturnType<Decoder>, undefined>) }
  },
): SettingsContract<Schema, ReturnType<Decoder>>
function defineSettings<const Schema extends z<any, object>>(definition: any): SettingsContract<Schema, any> {
  if (!NAMESPACE_PATTERN.test(definition.namespace)) {
    throw new TypeError(`Settings namespace ${JSON.stringify(definition.namespace)} must match ${String(NAMESPACE_PATTERN)}.`)
  }
  if (!zod.function().safeParse(definition.schema).success || !zod.function().safeParse(definition.schema.toJSON).success) {
    throw new TypeError(`Settings ${JSON.stringify(definition.namespace)} schema must be an official Schemastery schema.`)
  }
  if (definition.client !== undefined && !zod.function().safeParse(definition.client.decode).success) {
    throw new TypeError(`Settings ${JSON.stringify(definition.namespace)} client.decode must be a function.`)
  }
  // SAFETY: this module is the sole Settings contract constructor. The exact schema and host
  // methods below form the contract; the private WeakSet supplies its unforgeable runtime brand.
  const contract = {
    namespace: definition.namespace,
    schema: definition.schema,
    applies: definition.applies ?? 'live',
    ...(definition.client !== undefined && {
      client: {
        decode(value: unknown): any {
          const decoded = definition.client!.decode(value)
          if (decoded === undefined) throw new TypeError(`Settings ${JSON.stringify(definition.namespace)} client.decode returned undefined.`)
          return decoded
        },
      },
    }),
    host(options: SettingsHostOptions<SettingsValue<Schema>>): SettingsHostContribution<Schema, any> {
      // SAFETY: this opaque token is registered in settingsHostContributions before it escapes;
      // authenticity and payload access use that WeakMap, never properties on the token.
      const contribution = {} as SettingsHostContribution<Schema, any>
      settingsHostContributions.set(contribution, {
        contract,
        options,
      })
      return contribution
    },
  } as SettingsContract<Schema, any>
  settingsContracts.add(contract)
  return contract
}

export class SettingsDefinitionModel {
  static readonly schemaContainsSecret = settingsSchemaContainsSecret
  static readonly schemaHasUnsafeSecretPath = settingsSchemaHasUnsafeSecretPath
  static readonly isContract = isSettingsContract
  static readonly isHostContribution = isSettingsHostContribution
  static readonly hostContributionParts = settingsHostContributionParts
  static readonly contributionContract = settingsContributionContract
  static readonly define = defineSettings
}
