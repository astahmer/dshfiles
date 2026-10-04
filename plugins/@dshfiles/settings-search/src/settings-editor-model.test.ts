import { describe, expect, it } from 'vitest'
import { formatSettingsDraft, hasSettingsPath, parseSettingsDraft, readSettingsPath, schemaNodeAtPath, setOperationForSettingsTarget, settingsEditorKind, unsetOperationForSettingsTarget } from './settings-editor-model.js'
import { settingsChoiceOptions } from './settings-index.js'

const schema = {
  type: 'object',
  fields: {
    appearance: {
      type: 'object',
      fields: {
        scale: { type: 'number' },
        compact: { type: 'boolean' },
        title: { type: 'string' },
      },
    },
  },
}

describe('settings field editor model', () => {
  it('resolves only schema-backed field paths and reads nested live values', () => {
    expect(schemaNodeAtPath(schema, ['appearance', 'compact'])).toEqual({ type: 'boolean' })
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
    expect(setOperationForSettingsTarget(target, '#39a')).toEqual([
      { op: 'set', path: ['colors', 'accent'], value: '#39a' },
    ])
    expect(unsetOperationForSettingsTarget(target)).toEqual([
      { op: 'unset', path: ['colors', 'accent'] },
    ])
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
})
