import Schemastery from '@deepseek-ai/schemastery'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-model.js'
import { SettingProvenanceModel } from './setting-provenance.js'

const text = (value: JsonValue | undefined): string => Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrElse(() => ''))

const schema = Schema.decodeUnknownSync(jsonValueSchema)(
  Schemastery.object({
    enabled: Schemastery.boolean().default(true),
    maxTabs: Schemastery.natural().min(2).max(50).default(12),
    mode: Schemastery.union([Schemastery.const('a'), Schemastery.const('b')]).default('a'),
    tags: Schemastery.array(Schemastery.string()).default([]),
    layout: Schemastery.object({ dense: Schemastery.boolean().default(false) }),
    label: Schemastery.string(),
    token: Schemastery.string().role('secret'),
  }).toJSON(),
)
const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
const field = (key: string) => {
  const found = fields.find(candidate => candidate.key === key)
  if (found === undefined) throw new Error(`no field ${key}`)
  return found
}

describe('provenance', () => {
  const base = { enabled: true, maxTabs: 20, mode: 'a', tags: [], layout: { dense: false } }

  it('marks an override equal to what it inherits as explicit, and a reset target as the composition value', () => {
    const user = { maxTabs: 20, layout: { dense: true } }
    const value = { ...base, layout: { dense: true } }
    const maxTabs = SettingProvenanceModel.of({ field: field('maxTabs'), value, base, user })
    expect(maxTabs).toMatchObject({ source: 'user', explicit: true, equalsInherited: true, schemaDefault: 12, inherited: 20, effective: 20 })
    const dense = SettingProvenanceModel.of({ field: field('dense'), value, base, user })
    expect(dense).toMatchObject({ source: 'user', explicit: true, equalsInherited: false, inherited: false, effective: true })
  })

  it('tells a composition value from the schema default, and says unknown without a default to compare', () => {
    const value = { ...base, label: 'seeded' }
    const withLabel = { ...base, label: 'seeded' }
    expect(SettingProvenanceModel.of({ field: field('maxTabs'), value, base: withLabel, user: undefined }).source).toBe('composition')
    expect(SettingProvenanceModel.of({ field: field('enabled'), value, base: withLabel, user: undefined }).source).toBe('default')
    expect(SettingProvenanceModel.of({ field: field('tags'), value, base: withLabel, user: {} }).source).toBe('default')
    expect(SettingProvenanceModel.of({ field: field('label'), value, base: withLabel, user: {} }).source).toBe('unknown')
    expect(SettingProvenanceModel.of({ field: field('label'), value: undefined, base: undefined, user: undefined })).toMatchObject({
      source: 'unknown',
      effective: undefined,
    })
  })

  it('compares arrays and objects by value, not key order', () => {
    expect(SettingProvenanceModel.jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(SettingProvenanceModel.jsonEqual([1, 2], [2, 1])).toBe(false)
  })
})
