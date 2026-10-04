import { describe, expect, it } from 'vitest'
import { describeSettingsTargets, searchSettingsTargets, settingsNamespaceTitle } from './settings-index.js'

const namespaces = [{
  ns: 'threads',
  schema: {
    type: 'object',
    meta: { title: 'Thread settings' },
    fields: {
      editing: {
        type: 'object',
        meta: { label: 'Threads & editing' },
        fields: {
          queue: {
            type: 'object',
            meta: { label: 'Queue' },
            fields: {
              followup: {
                type: 'boolean',
                meta: { label: 'Default thread followup behavior', description: 'Choose how followup work is handled.' },
              },
            },
          },
        },
      },
      credentials: {
        type: 'object',
        meta: { label: 'Credentials' },
        fields: { token: { type: 'string', meta: { label: 'Token' } } },
      },
    },
  },
  secrets: [{ path: ['credentials', 'token'], set: true }],
}] as const

describe('settings descriptor search', () => {
  it('returns stable entry and field identities with namespace context', () => {
    const results = describeSettingsTargets(namespaces)
    const target = results.find(result => result.title === 'Default thread followup behavior')

    expect(target?.id).toBe(JSON.stringify(['threads', ['editing', 'queue', 'followup']]))
    expect(target?.target).toEqual({ entryId: 'threads', fieldPath: ['editing', 'queue', 'followup'] })
    expect(target?.context).toBe('Thread settings · threads · Threads & editing · Queue')
  })

  it('searches field names, descriptions, namespace and section context', () => {
    const results = describeSettingsTargets(namespaces)

    expect(searchSettingsTargets(results, 'followup').map(result => result.title)).toContain('Default thread followup behavior')
    expect(searchSettingsTargets(results, 'handled').map(result => result.title)).toContain('Default thread followup behavior')
    expect(searchSettingsTargets(results, 'Threads & editing').map(result => result.title)).toContain('Queue')
    expect(searchSettingsTargets(results, 'threads').length).toBeGreaterThan(0)
  })

  it('keeps empty-query browsing explicit and removes secret paths and descendants', () => {
    const results = describeSettingsTargets(namespaces)

    expect(searchSettingsTargets(results, ' ')).toEqual([])
    expect(results.some(result => result.title === 'Credentials')).toBe(false)
    expect(results.some(result => result.title === 'Token')).toBe(false)
  })

  it('uses schema titles for categories and searches accent-insensitively through finite option labels', () => {
    expect(settingsNamespaceTitle(namespaces[0]!)).toBe('Thread settings')

    const optionResults = describeSettingsTargets([{
      ns: 'locale',
      schema: {
        type: 'object',
        fields: {
          beverage: {
            type: 'union',
            meta: { label: 'Preferred beverage' },
            list: [
              { type: 'const', value: 'café', meta: { label: 'Coffee' } },
              { type: 'const', value: 'tea' },
            ],
          },
        },
      },
    }])

    expect(searchSettingsTargets(optionResults, 'cafe').map(result => result.title)).toContain('Preferred beverage')
    expect(searchSettingsTargets(optionResults, 'coffee').map(result => result.title)).toContain('Preferred beverage')
    expect(optionResults[0]?.options.map(option => option.label)).toEqual(['Coffee', 'tea'])
  })
})
