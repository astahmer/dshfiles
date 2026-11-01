import type { ApiClient } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import type { resourcePacksApi } from './api.js'
import {
  propertyTypes,
  resourceRefSchema,
  type PackDefinition,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type ResourceRecord,
  type ResourceRef,
} from './model.js'

export type ResourcePacksClient = Omit<ApiClient<typeof resourcePacksApi.methods>, 'safe'>

const isResourceRef = (value: unknown): value is ResourceRef => Schema.is(resourceRefSchema)(value)

const referenceListSchema = Schema.Array(resourceRefSchema).check(Schema.isMaxLength(100))

/** Pure representation and draft rules for the schema-driven Resources UI. */
export class ResourceUiModel {
  static readonly resourceKeys = ['resource-packs'] as const
  static readonly propertyTypes = propertyTypes
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

  /** The references a property value holds, ignoring anything that is not a resource reference. */
  static references(value: PropertyValue | undefined): readonly ResourceRef[] {
    if (!Array.isArray(value)) return []
    return value.filter((item: unknown): item is ResourceRef => isResourceRef(item))
  }

  static displayValue(property: PropertyDefinition, value: PropertyValue | undefined, resources: readonly ResourceRecord[]): string {
    if (value === null || value === undefined) return '—'
    if (property.type === 'select' && typeof value === 'string')
      return property.options.find(option => option.id === value)?.label ?? `Unknown option: ${value}`
    if (property.type === 'multiselect' && Array.isArray(value))
      return (
        value
          .map(id =>
            typeof id === 'string'
              ? (property.options.find(option => option.id === id)?.label ?? `Unknown option: ${id}`)
              : isResourceRef(id)
                ? ResourceUiModel.refText(id)
                : String(id),
          )
          .join(', ') || '—'
      )
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (Array.isArray(value))
      return (
        value
          .map((item: unknown) => (typeof item === 'string' ? item : isResourceRef(item) ? ResourceUiModel.referenceLabel(item, resources) : String(item)))
          .join(', ') || '—'
      )
    if (isResourceRef(value)) return ResourceUiModel.referenceLabel(value, resources)
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
    const values: Record<string, PropertyValue> = {}
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
          if (!isResourceRef(value)) fail()
          values[property.id] = value
          break
        }
        case 'references': {
          const parsed = Schema.decodeUnknownResult(referenceListSchema)(value)
          if (parsed._tag === 'Failure') fail()
          else values[property.id] = parsed.success
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
