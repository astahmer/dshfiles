import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
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

type ResourceMetadataPayload = PackDefinition | ResourceRecord | PropertyValues

/** ISO calendar dates, including leap years, exactly as the registry has always accepted them. */
const dateSource =
  /(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))/u
const dateOnly = Schema.String.check(Schema.isPattern(new RegExp(`^${dateSource.source}$`, 'u')))
const dateTime = Schema.String.check(
  Schema.isPattern(new RegExp(`^${dateSource.source}T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`, 'u')),
)

/** Shape parsing, domain compatibility and owner policy for resource metadata. */
export class ResourceValidation {
  static refuse(code: string, message: string): never {
    throw new PluginApiError(message, { code })
  }

  /** Aggregate byte budgets apply after shape parsing; individual field limits are not sufficient. */
  static assertPayloadSize(value: ResourceMetadataPayload, limit: number, subject: string): void {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) {
      ResourceValidation.refuse('payload-too-large', `${subject} exceeds its serialized metadata size limit. Reduce the metadata before retrying.`)
    }
  }

  /** Never echo submitted values, native ids, paths or arbitrary caller metadata in errors/audit. */
  static ownerOf(caller: ApiCaller): string {
    if (caller.kind !== 'plugin') return 'user'
    if (caller.packageId === 'user' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(caller.packageId) || caller.packageId.length > 200) {
      return ResourceValidation.refuse('invalid-caller', 'The contributing plugin must have a valid package identity distinct from the reserved user owner.')
    }
    return caller.packageId
  }

  // oxlint-disable-next-line antislop/no-unknown-parameters -- This is the Effect Schema parsing boundary for submitted or persisted pack definitions, not an unparsed domain operation.
  static parseDefinition(input: unknown): PackDefinition {
    const result = Schema.decodeUnknownResult(packDefinitionSchema, { onExcessProperty: 'error' })(input)
    if (result._tag === 'Failure')
      return ResourceValidation.refuse('invalid-definition', 'Invalid pack definition. Use bounded, typed properties without required fields or defaults.')
    const definition = result.success
    ResourceValidation.assertPayloadSize(definition, 128 * 1024, 'The pack definition')
    const fields = new Set<string>()
    for (const property of definition.properties) {
      if (fields.has(property.id)) ResourceValidation.refuse('invalid-definition', 'Pack property IDs must be unique.')
      fields.add(property.id)
      if (property.type !== 'select' && property.type !== 'multiselect') continue
      if (new Set(property.options.map(option => option.id)).size !== property.options.length) {
        ResourceValidation.refuse('invalid-definition', 'Select option IDs must be unique within each property.')
      }
    }
    return definition
  }

  static assertCompatible(previous: PackDefinition, next: PackDefinition): void {
    if (next.version <= previous.version) ResourceValidation.refuse('version-conflict', 'Publish a higher pack version to change its definition.')
    for (const before of previous.properties) {
      const after = next.properties.find(property => property.id === before.id)
      if (after === undefined || before.type !== after.type || before.readOnly !== after.readOnly) {
        ResourceValidation.refuse('migration-required', 'Removing properties, changing types or changing read-only rules requires an explicit migration.')
      }
      if ((before.type === 'select' || before.type === 'multiselect') && (after.type === 'select' || after.type === 'multiselect')) {
        const ids = new Set(after.options.map(option => option.id))
        if (before.options.some(option => !ids.has(option.id))) {
          ResourceValidation.refuse('migration-required', 'Removing option IDs requires an explicit migration. Rename labels without changing IDs instead.')
        }
      }
    }
  }

  private static validValue(property: PropertyDefinition, value: PropertyValue): boolean {
    if (value === null) return true
    switch (property.type) {
      case 'text':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'checkbox':
        return typeof value === 'boolean'
      case 'date':
        return Schema.is(dateOnly)(value)
      case 'datetime':
        return Schema.is(dateTime)(value)
      case 'select':
        return typeof value === 'string' && property.options.some(option => option.id === value)
      case 'multiselect': {
        if (!Array.isArray(value)) return false
        const options = new Set(property.options.map(option => option.id))
        const strings = value.filter((option): option is string => typeof option === 'string')
        return strings.length === value.length && new Set(strings).size === value.length && strings.every(option => options.has(option))
      }
      case 'reference':
        return Schema.is(resourceRefSchema)(value)
      case 'references': {
        if (!Array.isArray(value) || !value.every(ref => Schema.is(resourceRefSchema)(ref))) return false
        const keys = value.map(ref => JSON.stringify(ref))
        return new Set(keys).size === keys.length
      }
    }
  }

  // oxlint-disable-next-line antislop/no-unknown-parameters -- Submitted patches and SQLite JSON are parsed here before any domain checks or persistence.
  static parseValues(definition: PackDefinition, input: unknown, caller?: ApiCaller, owner?: string): PropertyValues {
    const result = Schema.decodeUnknownResult(propertyValuesSchema, { onExcessProperty: 'error' })(input)
    if (result._tag === 'Failure') return ResourceValidation.refuse('invalid-value', 'Invalid property values. Use the declared property types and bounded values.')
    if (caller !== undefined) ResourceValidation.assertPayloadSize(result.success, 64 * 1024, 'The property patch')
    for (const [id, value] of Object.entries(result.success)) {
      const property = definition.properties.find(property => property.id === id)
      if (property === undefined) ResourceValidation.refuse('unknown-property', 'The pack does not define one of these property IDs.')
      if (caller !== undefined && property.readOnly && (caller.kind !== 'plugin' || ResourceValidation.ownerOf(caller) !== owner)) {
        ResourceValidation.refuse('read-only', 'Only the plugin that owns this pack may write its read-only properties.')
      }
      if (!ResourceValidation.validValue(property, value))
        ResourceValidation.refuse('invalid-value', `The value does not match the declared ${property.type} property type or options.`)
    }
    return result.success
  }

  static fillMissing(definition: PackDefinition, values: PropertyValues): PropertyValues {
    return Object.fromEntries(definition.properties.map(property => [property.id, Object.hasOwn(values, property.id) ? (values[property.id] ?? null) : null]))
  }
}
