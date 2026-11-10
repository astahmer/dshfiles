import { SettingsSchemaModel, type JsonValue, type SettingField } from './schema-model.js'

/**
 * Where a field's effective value comes from, as far as the Host's settings view can prove it. The view carries three
 * layers per namespace: `value` (resolved), `base` (schema defaults plus every composition layer, merged) and `user`
 * (the profile's raw override section). It never says which composition file or bundle set a base value, so
 * `composition` names the merged layer, not a file.
 */
export type SettingSource = 'user' | 'composition' | 'default' | 'unknown'

export interface SettingProvenance {
  readonly source: SettingSource
  /** The user layer holds this path: modified, even when its value equals what it would inherit. */
  readonly explicit: boolean
  /** An explicit override whose value equals the inherited one. */
  readonly equalsInherited: boolean
  /** The schema's own default, when it declares one. */
  readonly schemaDefault: JsonValue | undefined
  /** What a reset re-inherits: the composition base, else the schema default. */
  readonly inherited: JsonValue | undefined
  readonly effective: JsonValue | undefined
}

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
const canonicalJson = (value: JsonValue | undefined): string => {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

const jsonEqual = (left: JsonValue | undefined, right: JsonValue | undefined): boolean => canonicalJson(left) === canonicalJson(right)

const provenanceOf = (input: {
  readonly field: SettingField
  readonly value: JsonValue | undefined
  readonly base: JsonValue | undefined
  readonly user: JsonValue | undefined
}): SettingProvenance => {
  const path = input.field.path
  const schemaDefault = input.field.defaultValue
  const explicit = SettingsSchemaModel.hasValueAt(input.user, path)
  const baseHas = SettingsSchemaModel.hasValueAt(input.base, path)
  const inherited = baseHas ? SettingsSchemaModel.valueAt(input.base, path) : schemaDefault
  const effective = SettingsSchemaModel.hasValueAt(input.value, path) ? SettingsSchemaModel.valueAt(input.value, path) : inherited
  const source = ((): SettingSource => {
    if (explicit) return 'user'
    if (!baseHas) return schemaDefault === undefined ? 'unknown' : 'default'
    if (schemaDefault === undefined) return 'unknown'
    return jsonEqual(inherited, schemaDefault) ? 'default' : 'composition'
  })()
  return {
    source,
    explicit,
    equalsInherited: explicit && jsonEqual(SettingsSchemaModel.valueAt(input.user, path), inherited),
    schemaDefault,
    inherited,
    effective,
  }
}

export class SettingProvenanceModel {
  static readonly of = provenanceOf
  static readonly jsonEqual = jsonEqual
}
