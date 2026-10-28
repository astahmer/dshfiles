import type { ApiClient } from '@dshfiles/dshx/api'
import type { resourcePacksApi } from './api.js'
import {
  propertyDefinitionSchema,
  resourceRefSchema,
  type PackDefinition,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type ResourceRecord,
  type ResourceRef,
} from './model.js'

export type ResourcePacksClient = Omit<ApiClient<typeof resourcePacksApi.methods>, 'safe'>

/** Pure representation and draft rules for the schema-driven Resources UI. */
export class ResourceUiModel {
  static readonly resourceKeys = ['resource-packs'] as const
  static readonly propertyTypes = propertyDefinitionSchema.options.map(option => option.shape.type.value)
  static refKey(ref: ResourceRef): string {
    return JSON.stringify([ref.provider, ref.kind, ref.id])
  }
  static refText(ref: ResourceRef): string {
    return `${ref.provider} / ${ref.kind} / ${ref.id}`
  }
  static attachmentFor(resource: ResourceRecord, packId: string) {
    return resource.attachments.find(attachment => attachment.packId === packId)
  }
  static slugFromLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 80)
  }

  static displayValue(property: PropertyDefinition, value: PropertyValue | undefined, resources: readonly ResourceRecord[]): string {
    if (value === null || value === undefined) return '—'
    // oxlint-disable-next-line antislop/no-runtime-typeof -- PropertyValue is the schema-validated domain union; rendering selects its string variant.
    if (property.type === 'select' && typeof value === 'string')
      return property.options.find(option => option.id === value)?.label ?? `Unknown option: ${value}`
    if (property.type === 'multiselect' && Array.isArray(value))
      return (
        value
          .map(id =>
            typeof id === 'string' ? (property.options.find(option => option.id === id)?.label ?? `Unknown option: ${id}`) : ResourceUiModel.refText(id),
          )
          .join(', ') || '—'
      )
    // oxlint-disable-next-line antislop/no-runtime-typeof -- Render the boolean variant of the validated PropertyValue union, not an untrusted payload.
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? item : ResourceUiModel.referenceLabel(item, resources))).join(', ') || '—'
    // oxlint-disable-next-line antislop/no-runtime-typeof -- After null/array narrowing, the union object variant is exactly ResourceRef.
    if (typeof value === 'object') return ResourceUiModel.referenceLabel(value, resources)
    return String(value)
  }

  static referenceLabel(ref: ResourceRef, resources: readonly ResourceRecord[]): string {
    return (
      resources.find(resource => ResourceUiModel.refKey(resource.ref) === ResourceUiModel.refKey(ref))?.label ??
      `Unregistered reference: ${ResourceUiModel.refText(ref)}`
    )
  }

  /** Validate against the current definition, never infer a column or type from stored values. */
  static validatedValues(pack: PackDefinition, draft: PropertyValues): PropertyValues {
    const values: PropertyValues = {}
    for (const property of pack.properties) {
      if (property.readOnly) continue
      const raw = Object.hasOwn(draft, property.id) ? draft[property.id] : undefined
      const value = raw === '' || raw === undefined ? null : raw
      if (value === null) {
        values[property.id] = null
        continue
      }
      const fail = (): never => {
        throw new Error(`${property.label}: enter a valid ${property.type} value.`)
      }
      switch (property.type) {
        case 'text':
          // oxlint-disable-next-line antislop/no-runtime-typeof -- Validate a Form draft union member against the current text definition before mutation.
          if (typeof value !== 'string' || value.length > 20_000) fail()
          values[property.id] = value
          break
        case 'number': {
          // oxlint-disable-next-line antislop/no-runtime-typeof -- A number control's draft may be numeric or a temporary string; other domain variants are invalid.
          if (typeof value !== 'number' && typeof value !== 'string') fail()
          const number = Number(value)
          if (!Number.isFinite(number)) fail()
          values[property.id] = number
          break
        }
        case 'checkbox':
          // oxlint-disable-next-line antislop/no-runtime-typeof -- Confirm the draft union is the definition's boolean variant before writing it.
          if (typeof value !== 'boolean') fail()
          values[property.id] = value
          break
        case 'date': {
          if (
            // oxlint-disable-next-line antislop/no-runtime-typeof -- Draft union validation also checks date syntax and calendar validity, not just representation.
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value
          )
            fail()
          values[property.id] = value
          break
        }
        case 'datetime': {
          // oxlint-disable-next-line antislop/no-runtime-typeof -- Validate the draft's string variant and timestamp before canonical ISO conversion.
          if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail()
          values[property.id] = new Date(String(value)).toISOString()
          break
        }
        case 'select':
          // oxlint-disable-next-line antislop/no-runtime-typeof -- Definition validation checks the draft string against stable option IDs.
          if (typeof value !== 'string' || !property.options.some(option => option.id === value)) fail()
          values[property.id] = value
          break
        case 'multiselect':
          if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && property.options.some(option => option.id === id))) fail()
          values[property.id] = value
          break
        case 'reference': {
          const parsed = resourceRefSchema.safeParse(value)
          if (!parsed.success) fail()
          else values[property.id] = parsed.data
          break
        }
        case 'references': {
          if (!Array.isArray(value)) fail()
          const parsed = resourceRefSchema.array().max(100).safeParse(value)
          if (!parsed.success) fail()
          else values[property.id] = parsed.data
          break
        }
      }
    }
    return values
  }

  static datetimeInput(value: PropertyValue | undefined): string {
    // oxlint-disable-next-line antislop/no-runtime-typeof -- A datetime editor renders only the union's valid timestamp-string variant.
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return ''
    const date = new Date(value)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }
}
