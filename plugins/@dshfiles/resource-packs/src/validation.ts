import type { ApiCaller } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'
import {
  InvalidCaller,
  InvalidPackDefinition,
  InvalidPropertyValues,
  MetadataTooLarge,
  PackMigrationRequired,
  PackVersionConflict,
  ReadOnlyProperty,
  UnknownProperty,
} from './errors.js'
import {
  packDefinitionSchema,
  propertyValuesSchema,
  resourceRefSchema,
  type PackDefinition,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type ResourceRecord,
} from './model.js'

/** ISO calendar dates, including leap years, exactly as the registry has always accepted them. */
const dateSource =
  /(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))/u
const isDateOnly = Schema.is(Schema.String.check(Schema.isPattern(new RegExp(`^${dateSource.source}$`, 'u'))))
const isDateTime = Schema.is(
  Schema.String.check(
    Schema.isPattern(new RegExp(`^${dateSource.source}T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`, 'u')),
  ),
)
const isResourceRef = Schema.is(resourceRefSchema)
const decodeDefinition = Schema.decodeUnknownEffect(packDefinitionSchema, { onExcessProperty: 'error' })
const decodePersistedValues = Schema.decodeUnknownEffect(Schema.fromJsonString(propertyValuesSchema), { onExcessProperty: 'error' })

/** Aggregate byte budgets apply after shape parsing; individual field limits are not sufficient. */
const payloadLimits = { 'pack-definition': 128 * 1024, resource: 256 * 1024, 'property-patch': 64 * 1024 } as const

const assertPayloadSize = (input: { readonly value: PackDefinition | ResourceRecord | PropertyValues; readonly subject: keyof typeof payloadLimits }) =>
  Buffer.byteLength(JSON.stringify(input.value), 'utf8') > payloadLimits[input.subject]
    ? Effect.fail(new MetadataTooLarge({ subject: input.subject, limitBytes: payloadLimits[input.subject] }))
    : Effect.void

const packagePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u

/** Never echo submitted values, native ids, paths or arbitrary caller metadata in errors/audit. */
const ownerOf = (caller: ApiCaller): Effect.Effect<string, InvalidCaller> => {
  if (caller.kind !== 'plugin') return Effect.succeed('user')
  if (caller.packageId === 'user' || !packagePattern.test(caller.packageId) || caller.packageId.length > 200) return Effect.fail(new InvalidCaller())
  return Effect.succeed(caller.packageId)
}

const duplicateProblem = (definition: PackDefinition): 'duplicate-property' | 'duplicate-option' | undefined => {
  if (new Set(definition.properties.map(property => property.id)).size !== definition.properties.length) return 'duplicate-property'
  const duplicateOption = definition.properties.some(
    property =>
      (property.type === 'select' || property.type === 'multiselect') && new Set(property.options.map(option => option.id)).size !== property.options.length,
  )
  return duplicateOption ? 'duplicate-option' : undefined
}

/** Decoding also puts keys in schema order, so an identical re-registration compares equal however the caller ordered them. */
const checkDefinition = Effect.fn('resource pack definition check')(function* (input: PackDefinition) {
  const definition = yield* decodeDefinition(input).pipe(Effect.mapError(cause => new InvalidPackDefinition({ reason: 'shape', cause })))
  yield* assertPayloadSize({ value: definition, subject: 'pack-definition' })
  const problem = duplicateProblem(definition)
  if (problem !== undefined) return yield* new InvalidPackDefinition({ reason: problem })
  return definition
})

const assertCompatible = Effect.fn('resource pack compatibility check')(function* (input: {
  readonly previous: PackDefinition
  readonly next: PackDefinition
}) {
  if (input.next.version <= input.previous.version) return yield* new PackVersionConflict()
  for (const before of input.previous.properties) {
    const after = input.next.properties.find(property => property.id === before.id)
    if (after === undefined || before.type !== after.type || before.readOnly !== after.readOnly) {
      return yield* new PackMigrationRequired({ reason: 'property-changed' })
    }
    if (before.type !== 'select' && before.type !== 'multiselect') continue
    if (after.type !== 'select' && after.type !== 'multiselect') continue
    const ids = new Set(after.options.map(option => option.id))
    if (before.options.some(option => !ids.has(option.id))) return yield* new PackMigrationRequired({ reason: 'option-removed' })
  }
})

const validValue = (property: PropertyDefinition, value: PropertyValue): boolean => {
  if (value === null) return true
  switch (property.type) {
    case 'text':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'checkbox':
      return typeof value === 'boolean'
    case 'date':
      return isDateOnly(value)
    case 'datetime':
      return isDateTime(value)
    case 'select':
      return typeof value === 'string' && property.options.some(option => option.id === value)
    case 'multiselect': {
      if (!Array.isArray(value)) return false
      const options = new Set(property.options.map(option => option.id))
      const strings = value.filter((option): option is string => typeof option === 'string')
      return strings.length === value.length && new Set(strings).size === value.length && strings.every(option => options.has(option))
    }
    case 'reference':
      return isResourceRef(value)
    case 'references': {
      if (!Array.isArray(value) || !value.every(isResourceRef)) return false
      const keys = value.map(ref => JSON.stringify(ref))
      return new Set(keys).size === keys.length
    }
  }
}

/** A writer is the caller of a patch; persisted values are checked without one. */
const checkValues = Effect.fn('resource pack values check')(function* (input: {
  readonly definition: PackDefinition
  readonly values: PropertyValues
  readonly writer?: { readonly caller: ApiCaller; readonly owner: string }
}) {
  const writer = input.writer
  if (writer !== undefined) yield* assertPayloadSize({ value: input.values, subject: 'property-patch' })
  for (const [id, value] of Object.entries(input.values)) {
    const property = input.definition.properties.find(candidate => candidate.id === id)
    if (property === undefined) return yield* new UnknownProperty()
    if (writer !== undefined && property.readOnly) {
      const ownerWrites = writer.caller.kind === 'plugin' && (yield* ownerOf(writer.caller)) === writer.owner
      if (!ownerWrites) return yield* new ReadOnlyProperty()
    }
    if (!validValue(property, value)) return yield* new InvalidPropertyValues({ propertyType: property.type })
  }
  return input.values
})

const readPersistedValues = Effect.fn('resource pack stored values read')(function* (input: { readonly definition: PackDefinition; readonly json: string }) {
  const values = yield* decodePersistedValues(input.json).pipe(Effect.mapError(cause => new InvalidPropertyValues({ cause })))
  return yield* checkValues({ definition: input.definition, values })
})

const fillMissing = (definition: PackDefinition, values: PropertyValues): PropertyValues =>
  Object.fromEntries(definition.properties.map(property => [property.id, Object.hasOwn(values, property.id) ? (values[property.id] ?? null) : null]))

/** Domain compatibility, budgets and owner policy for resource metadata; shapes are decoded at the API boundary. */
export const ResourceValidation = {
  assertPayloadSize,
  ownerOf,
  checkDefinition,
  assertCompatible,
  checkValues,
  readPersistedValues,
  fillMissing,
} as const
