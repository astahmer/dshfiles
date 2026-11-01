import Schemastery from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-model.js'

const text = (value: JsonValue | undefined): string => Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrElse(() => ''))

const schema = Schema.decodeUnknownSync(jsonValueSchema)(
  Schemastery.object({
    enabled: Schemastery.boolean().default(true).description('Show the strip.'),
    maxTabs: Schemastery.natural().min(2).max(50).default(12).description('Most tabs.'),
    idleMinutes: Schemastery.number().default(30),
    ratio: Schemastery.percent().default(0.5),
    openMode: Schemastery.union([
      Schemastery.const('preview').description('Preview: what you open replaces the preview tab.'),
      Schemastery.const('new').description('New tab'),
      Schemastery.const('replace'),
    ]).default('preview'),
    notes: Schemastery.string().role('textarea').default(''),
    token: Schemastery.string().role('secret'),
    secretRef: Schemastery.string().role('secret-ref').default(''),
    tags: Schemastery.array(Schemastery.string()).default([]),
    colors: Schemastery.dict(Schemastery.union(['warning', 'success'])).default({}),
    layout: Schemastery.object({ dense: Schemastery.boolean().default(false).description('Tighter rows.') }),
    state: Schemastery.string().hidden(),
    rows: Schemastery.array(Schemastery.object({ id: Schemastery.string() })),
  }).toJSON(),
)

describe('settingFields', () => {
  const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
  const byKey = new Map(fields.map(field => [field.key, field]))

  it('turns each visible setting into a titled field with the control its type calls for', () => {
    expect(fields.map(field => field.key)).toEqual([
      'enabled',
      'maxTabs',
      'idleMinutes',
      'ratio',
      'openMode',
      'notes',
      'secretRef',
      'tags',
      'colors',
      'dense',
      'rows',
    ])
    expect(byKey.get('enabled')).toMatchObject({ title: 'Enabled', description: 'Show the strip.', control: { kind: 'boolean' }, defaultValue: true })
    expect(byKey.get('maxTabs')?.control).toEqual({ kind: 'number', percent: false, min: 2, max: 50, step: 1 })
    expect(byKey.get('idleMinutes')?.control).toMatchObject({ kind: 'number', unit: 'min' })
    expect(byKey.get('ratio')?.control).toMatchObject({ kind: 'number', percent: true, unit: '%' })
    expect(byKey.get('openMode')?.control).toEqual({
      kind: 'choice',
      options: [
        { value: 'preview', label: 'Preview', detail: 'what you open replaces the preview tab.' },
        { value: 'new', label: 'New tab', detail: '' },
        { value: 'replace', label: 'replace', detail: '' },
      ],
    })
    expect(byKey.get('notes')?.control).toEqual({ kind: 'text', multiline: true })
    expect(byKey.get('secretRef')?.control).toEqual({ kind: 'text', multiline: false, secretReference: true })
  })

  it('edits arrays and dicts of scalars as lists and records, and anything else as JSON', () => {
    expect(byKey.get('tags')?.control).toEqual({ kind: 'list', item: { kind: 'text', multiline: false } })
    expect(byKey.get('colors')?.control).toMatchObject({ kind: 'record', value: { kind: 'choice' } })
    expect(byKey.get('rows')?.control).toEqual({ kind: 'json' })
  })

  it('groups nested objects and leaves hidden and secret fields out', () => {
    expect(byKey.get('dense')).toMatchObject({ path: ['layout', 'dense'], groups: ['Layout'] })
    expect(byKey.has('token')).toBe(false)
    expect(byKey.has('state')).toBe(false)
    expect(SettingsSchemaModel.settingFields({ schema, secrets: [{ path: ['layout'] }], text }).some(field => field.key === 'dense')).toBe(false)
  })

  it('reads nothing from an unreadable schema', () => {
    expect(SettingsSchemaModel.settingFields({ schema: { nope: true }, text })).toEqual([])
  })
})

describe('labels and units', () => {
  it('humanizes keys and reads units from their suffix', () => {
    expect(SettingsSchemaModel.humanizeKey('archiveUndoDurationSeconds')).toBe('Archive undo duration seconds')
    expect(SettingsSchemaModel.unitOfKey('archiveUndoDurationSeconds')).toBe('s')
    expect(SettingsSchemaModel.unitOfKey('pollMs')).toBe('ms')
    expect(SettingsSchemaModel.unitOfKey('maxTabs')).toBeUndefined()
  })

  it('shows a few short choices as segments and the rest as a select', () => {
    expect(SettingsSchemaModel.choiceDisplay([{ value: 'a', label: 'A', detail: '' }])).toBe('segmented')
    expect(SettingsSchemaModel.choiceDisplay(['a', 'b', 'c', 'd', 'e'].map(value => ({ value, label: value, detail: '' })))).toBe('select')
  })
})

describe('paths', () => {
  it('reads nested values and tells an override apart from a missing key', () => {
    const user = { layout: { dense: false }, tags: ['a'] }
    expect(SettingsSchemaModel.valueAt(user, ['layout', 'dense'])).toBe(false)
    expect(SettingsSchemaModel.valueAt(user, ['tags', '0'])).toBe('a')
    expect(SettingsSchemaModel.hasValueAt(user, ['layout', 'dense'])).toBe(true)
    expect(SettingsSchemaModel.hasValueAt(user, ['layout', 'wide'])).toBe(false)
    expect(SettingsSchemaModel.hasValueAt(undefined, ['enabled'])).toBe(false)
  })
})
