import Schemastery from '@deepseek-ai/schemastery'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-model.js'
import { SettingsDocument } from './settings-document.js'

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

describe('settings document', () => {
  it('accepts fields and the objects that hold them, and flags unknown keys, secrets and wrong types with their line', () => {
    const draft = ['{', '  "maxTabs": 99,', '  "layout": { "dense": "yes" },', '  "token": "x",', '  "typo": 1,', '  "mode": "b"', '}'].join('\n')
    const parsed = SettingsDocument.parse({ text: draft, fields })
    expect(parsed.ok).toBe(true)
    expect(parsed.diagnostics).toEqual([
      { code: 'type', path: ['maxTabs'], line: 2, expected: { shape: 'scalar', control: field('maxTabs').control } },
      { code: 'type', path: ['layout', 'dense'], line: 3, expected: { shape: 'scalar', control: { kind: 'boolean' } } },
      { code: 'unknown-key', path: ['token'], line: 4 },
      { code: 'unknown-key', path: ['typo'], line: 5 },
    ])
  })

  it('finds the key of a set field, nested ones included, and nothing for a field the document leaves out', () => {
    const draft = ['{', '  "maxTabs": 3,', '  "layout": {', '    "dense": true', '  }', '}'].join('\n')
    const nested = SettingsDocument.keyRange({ text: draft, path: ['layout', 'dense'] })
    expect(nested === undefined ? undefined : draft.slice(nested.start, nested.end)).toBe('"dense"')
    expect(draft.slice(0, nested?.start).split('\n')).toHaveLength(4)
    expect(SettingsDocument.keyRange({ text: draft, path: ['enabled'] })).toBeUndefined()
  })

  it('reports a parse error with its line and refuses a document that is not an object', () => {
    const broken = SettingsDocument.parse({ text: '{\n  "maxTabs": 3,\n  oops\n}', fields })
    expect(broken.ok).toBe(false)
    expect(broken.diagnostics[0]?.code).toBe('parse')
    expect(broken.diagnostics[0]?.line).toBe(3)
    expect(SettingsDocument.parse({ text: '[1]', fields }).diagnostics).toEqual([{ code: 'not-object', path: [], line: 1 }])
    expect(SettingsDocument.parse({ text: '  ', fields })).toMatchObject({ ok: true, value: {}, diagnostics: [] })
  })

  it('turns an edit into set and unset operations for changed fields only', () => {
    const before = { maxTabs: 20, enabled: false, tags: ['x'] }
    const after = { maxTabs: 20, tags: ['x', 'y'], layout: { dense: true } }
    expect(SettingsDocument.operations({ fields, before, after })).toEqual([
      { op: 'unset', path: ['enabled'] },
      { op: 'set', path: ['tags'], value: ['x', 'y'] },
      { op: 'set', path: ['layout', 'dense'], value: true },
    ])
    expect(SettingsDocument.operations({ fields, before, after: before })).toEqual([])
  })

  it('projects what every field inherits, nested, without writable lines for fields with no value', () => {
    expect(SettingsDocument.inheritedDocument({ fields, base: { maxTabs: 20 } })).toEqual({
      enabled: true,
      maxTabs: 20,
      mode: 'a',
      tags: [],
      layout: { dense: false },
    })
  })

  it('inserts a field into a parsable draft and refuses an unparsable one', () => {
    expect(SettingsDocument.withField({ text: '{ "maxTabs": 3 }', field: field('dense'), value: false })).toBe(
      `${JSON.stringify({ maxTabs: 3, layout: { dense: false } }, null, 2)}\n`,
    )
    expect(SettingsDocument.withField({ text: '{ nope', field: field('dense'), value: false })).toBeUndefined()
  })
})
