import { describe, expect, it } from 'vitest'
import {
  formatSettingsDraft,
  hasSettingsPath,
  parseSettingsDraft,
  readSettingsPath,
  schemaNodeAtPath,
  setOperationForSettingsTarget,
  settingsEditorKind,
  unsetOperationForSettingsTarget,
} from './settings-editor-model.js'
import { describeSettingsTargets, settingsChoiceOptions } from './settings-index.js'

/**
 * The wire shape: `schema.toJSON()` is a `refs` table keyed by uid, `uid` is the
 * root, and an object's `dict` maps field name to that field's uid.
 */
const schema = {
  uid: 5,
  refs: {
    0: { type: 'number', meta: {} },
    1: { type: 'boolean', meta: {} },
    2: { type: 'string', meta: {} },
    3: { type: 'object', meta: {}, dict: { scale: 0, compact: 1, title: 2 } },
    5: { type: 'object', meta: {}, dict: { appearance: 3 } },
  },
}

describe('settings field editor model', () => {
  it('resolves only schema-backed field paths and reads nested live values', () => {
    expect(schemaNodeAtPath(schema, ['appearance', 'compact'])).toEqual({ type: 'boolean', meta: {} })
    expect(schemaNodeAtPath(schema, ['appearance', 'missing'])).toBeNull()
    expect(readSettingsPath({ appearance: { compact: false } }, ['appearance', 'compact'])).toBe(false)
    expect(hasSettingsPath({ appearance: { compact: false } }, ['appearance', 'compact'])).toBe(true)
    expect(hasSettingsPath({}, ['appearance', 'compact'])).toBe(false)
  })

  it('parses edits into typed JSON values and rejects invalid drafts', () => {
    expect(settingsEditorKind({ type: 'integer' }, 4)).toBe('number')
    expect(parseSettingsDraft('false', 'boolean')).toEqual({ ok: true, value: false })
    expect(parseSettingsDraft('no', 'boolean').ok).toBe(false)
    expect(parseSettingsDraft('3.5', 'number')).toEqual({ ok: true, value: 3.5 })
    expect(parseSettingsDraft('', 'number').ok).toBe(false)
    expect(parseSettingsDraft('Infinity', 'number').ok).toBe(false)
    expect(parseSettingsDraft('{"enabled":true}', 'json')).toEqual({ ok: true, value: { enabled: true } })
    expect(parseSettingsDraft('{bad', 'json').ok).toBe(false)
    expect(parseSettingsDraft('literal', 'string')).toEqual({ ok: true, value: 'literal' })
  })

  it('maps a selected stable target to one exact set or inherited-value operation', () => {
    const target = { entryId: 'appearance', fieldPath: ['colors', 'accent'] }
    expect(setOperationForSettingsTarget(target, '#39a')).toEqual([{ op: 'set', path: ['colors', 'accent'], value: '#39a' }])
    expect(unsetOperationForSettingsTarget(target)).toEqual([{ op: 'unset', path: ['colors', 'accent'] }])
  })

  it('formats absent defaults as blank and preserves multiline JSON drafts', () => {
    expect(formatSettingsDraft(undefined, 'string')).toBe('')
    expect(formatSettingsDraft({ nested: true }, 'json')).toBe(['{', '  "nested": true', '}'].join('\n'))
  })

  it('uses typed select choices for union-of-constant schema fields', () => {
    const choiceSchema = {
      type: 'union',
      list: [
        { type: 'const', value: 'steer' },
        { type: 'const', value: 'queue' },
      ],
    }
    const choices = settingsChoiceOptions(choiceSchema)

    expect(settingsEditorKind(choiceSchema, 'queue', choices)).toBe('choice')
    expect(formatSettingsDraft('queue', 'choice', choices)).toBe('1')
    expect(parseSettingsDraft('0', 'choice', choices)).toEqual({ ok: true, value: 'steer' })
    expect(parseSettingsDraft('2', 'choice', choices).ok).toBe(false)
  })

  it('keeps referenced union options from the indexed result in the fallback editor', () => {
    const themeSchema = {
      uid: 4,
      refs: {
        0: { type: 'const', value: 'light', meta: { label: 'Light' } },
        1: { type: 'const', value: 'dark', meta: { label: 'Dark' } },
        2: { type: 'const', value: 'system', meta: { label: 'System' } },
        3: { type: 'union', list: [0, 1, 2], meta: { label: 'Preference' } },
        4: { type: 'object', dict: { preference: 3 }, meta: {} },
      },
    }
    const result = describeSettingsTargets([{ ns: 'ui-theme', schema: themeSchema }]).find(setting => setting.target.fieldPath.join('.') === 'preference')
    if (result === undefined) throw new Error('Expected the Appearance preference in the settings index')
    const node = schemaNodeAtPath(themeSchema, ['preference'])
    const choices = result.options

    expect(choices.map(choice => choice.label)).toEqual(['Light', 'Dark', 'System'])
    expect(settingsEditorKind(node, 'light', choices)).toBe('choice')
    expect(formatSettingsDraft('light', 'choice', choices)).toBe('0')
    expect(parseSettingsDraft('1', 'choice', choices)).toEqual({ ok: true, value: 'dark' })
  })
})
