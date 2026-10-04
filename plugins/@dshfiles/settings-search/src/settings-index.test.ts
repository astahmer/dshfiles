import { describe, expect, it } from 'vitest'
import { describeSettingsTargets, searchSettingsTargets, settingsNamespaceTitle } from './settings-index.js'

/**
 * Build the wire shape `settings.describe` actually sends.
 *
 * A namespace schema arrives as `schema.toJSON()`: a `refs` table keyed by uid,
 * where `uid` is the root and an object's `dict` maps field name to that field's
 * uid. Fixtures are written through this builder so a test cannot drift back to
 * an invented `{ fields }` shape the Host never sends.
 */
const envelope = (root: number, refs: Readonly<Record<number, unknown>>) => ({ uid: root, refs }) as const

const namespaces = [
  {
    ns: 'threads',
    schema: envelope(7, {
      0: { type: 'string', meta: {} },
      1: { type: 'object', meta: { label: 'Threads & editing' }, dict: { queue: 2 } },
      2: { type: 'object', meta: { label: 'Queue' }, dict: { followup: 3 } },
      3: {
        type: 'boolean',
        meta: { label: 'Default thread followup behavior', description: 'Choose how followup work is handled.' },
      },
      4: { type: 'object', meta: { label: 'Credentials' }, dict: { token: 0 } },
      7: { type: 'object', meta: { title: 'Thread settings' }, dict: { editing: 1, credentials: 4 } },
    }),
    secrets: [{ path: ['credentials', 'token'], set: true }],
  },
] as const

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

    const optionResults = describeSettingsTargets([
      {
        ns: 'locale',
        schema: envelope(6, {
          0: { type: 'const', value: 'café', meta: { label: 'Coffee' } },
          1: { type: 'const', value: 'tea', meta: {} },
          2: { type: 'union', meta: { label: 'Preferred beverage' }, list: [0, 1] },
          6: { type: 'object', meta: {}, dict: { beverage: 2 } },
        }),
      },
    ])

    expect(searchSettingsTargets(optionResults, 'cafe').map(result => result.title)).toContain('Preferred beverage')
    expect(searchSettingsTargets(optionResults, 'coffee').map(result => result.title)).toContain('Preferred beverage')
    expect(optionResults[0]?.options.map(option => option.label)).toEqual(['Coffee', 'tea'])
  })

  it('descends from each field node instead of restarting at the root', () => {
    // A self-referential node must not expand without bound: the walk descends
    // from the child it just resolved, so a cycle stops instead of re-walking
    // the schema top once per field.
    const cyclic = describeSettingsTargets([
      {
        ns: 'loop',
        schema: envelope(1, {
          0: { type: 'string', meta: { label: 'Leaf' } },
          1: { type: 'object', meta: {}, dict: { self: 1, leaf: 0 } },
        }),
      },
    ])

    const paths = cyclic.map(result => result.target.fieldPath.join('.'))
    expect(paths).toContain('leaf')
    expect(paths.some(path => path.split('.').length > 9)).toBe(false)
    expect(new Set(paths).size).toBe(paths.length)
  })
})