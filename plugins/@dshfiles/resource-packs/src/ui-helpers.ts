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
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? item : ResourceUiModel.referenceLabel(item, resources))).join(', ') || '—'
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
          if (typeof value !== 'string' || value.length > 20_000) fail()
          values[property.id] = value
          break
        case 'number': {
          if (typeof value !== 'number' && typeof value !== 'string') fail()
          const number = Number(value)
          if (!Number.isFinite(number)) fail()
          values[property.id] = number
          break
        }
        case 'checkbox':
          if (typeof value !== 'boolean') fail()
          values[property.id] = value
          break
        case 'date': {
          if (
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
          if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail()
          values[property.id] = new Date(String(value)).toISOString()
          break
        }
        case 'select':
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
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return ''
    const date = new Date(value)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }
}
