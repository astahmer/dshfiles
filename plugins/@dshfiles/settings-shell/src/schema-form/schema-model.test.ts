import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { choiceDisplay, hasValueAt, humanizeKey, jsonValueSchema, settingFields, unitOfKey, valueAt, type JsonValue } from './schema-model.js'

const text = (value: JsonValue | undefined): string => z.string().catch('').parse(value)

const schema = jsonValueSchema.parse(
  Schema.object({
    enabled: Schema.boolean().default(true).description('Show the strip.'),
    maxTabs: Schema.natural().min(2).max(50).default(12).description('Most tabs.'),
    idleMinutes: Schema.number().default(30),
    ratio: Schema.percent().default(0.5),
    openMode: Schema.union([
      Schema.const('preview').description('Preview: what you open replaces the preview tab.'),
      Schema.const('new').description('New tab'),
      Schema.const('replace'),
    ]).default('preview'),
    notes: Schema.string().role('textarea').default(''),
    token: Schema.string().role('secret'),
    tags: Schema.array(Schema.string()).default([]),
    colors: Schema.dict(Schema.union(['warning', 'success'])).default({}),
    layout: Schema.object({ dense: Schema.boolean().default(false).description('Tighter rows.') }),
    state: Schema.string().hidden(),
    rows: Schema.array(Schema.object({ id: Schema.string() })),
  }).toJSON(),
)

describe('settingFields', () => {
  const fields = settingFields({ schema, secrets: [], text })
  const byKey = new Map(fields.map(field => [field.key, field]))

  it('turns each visible setting into a titled field with the control its type calls for', () => {
    expect(fields.map(field => field.key)).toEqual(['enabled', 'maxTabs', 'idleMinutes', 'ratio', 'openMode', 'notes', 'tags', 'colors', 'dense', 'rows'])
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
    expect(settingFields({ schema, secrets: [{ path: ['layout'] }], text }).some(field => field.key === 'dense')).toBe(false)
  })

  it('reads nothing from an unreadable schema', () => {
    expect(settingFields({ schema: { nope: true }, text })).toEqual([])
  })
})

describe('labels and units', () => {
  it('humanizes keys and reads units from their suffix', () => {
    expect(humanizeKey('archiveUndoDurationSeconds')).toBe('Archive undo duration seconds')
    expect(unitOfKey('archiveUndoDurationSeconds')).toBe('s')
    expect(unitOfKey('pollMs')).toBe('ms')
    expect(unitOfKey('maxTabs')).toBeUndefined()
  })

  it('shows a few short choices as segments and the rest as a select', () => {
    expect(choiceDisplay([{ value: 'a', label: 'A', detail: '' }])).toBe('segmented')
    expect(choiceDisplay(['a', 'b', 'c', 'd', 'e'].map(value => ({ value, label: value, detail: '' })))).toBe('select')
  })
})

describe('paths', () => {
  it('reads nested values and tells an override apart from a missing key', () => {
    const user = { layout: { dense: false }, tags: ['a'] }
    expect(valueAt(user, ['layout', 'dense'])).toBe(false)
    expect(valueAt(user, ['tags', '0'])).toBe('a')
    expect(hasValueAt(user, ['layout', 'dense'])).toBe(true)
    expect(hasValueAt(user, ['layout', 'wide'])).toBe(false)
    expect(hasValueAt(undefined, ['enabled'])).toBe(false)
  })
})
