import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { SettingsPluginPages } from './plugin-settings.js'
import { jsonValueSchema } from './schema-form/schema-model.js'
import { SettingsSearch } from './settings-search.js'

const wire = (schema: Schema) => jsonValueSchema.parse(schema.toJSON())

const pages = SettingsPluginPages.pluginSettingsPages({
  namespaces: [
    {
      ns: 'thread-sidebar',
      autoGenerate: true,
      schema: wire(
        Schema.object({
          archiveUndoEnabled: Schema.boolean().description('Show a temporary undo notice after archiving threads.'),
          autoArchiveEnabled: Schema.boolean().description('Archive idle threads automatically.'),
          autoArchiveSessionIds: Schema.array(Schema.string()).hidden(),
          maxChildren: Schema.natural().description('Child threads listed under a parent.'),
        }),
      ),
    },
    { ns: 'dshfiles-main-tabs', autoGenerate: true, schema: wire(Schema.object({ maxTabs: Schema.natural().description('Préférences des onglets.') })) },
  ],
  labels: new Map([['thread-sidebar', { title: 'Thread Sidebar', description: '' }]]),
  text: SettingsPluginPages.localizedTextReader('en'),
})
const sections = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'archived-sessions', order: 30, label: 'Archived threads' },
]
const invalid: string[] = []
const entries = SettingsSearch.entryRows({
  onInvalid: failure => invalid.push(failure.sectionId),
  sections: [...sections, { id: 'broken', order: 40, label: 'Broken' }],
  published: new Map([
    ['general', [{ id: 'developer-tools', title: 'Developer tools', description: 'Show debugging panels.', keywords: 'devtools inspector' }]],
    ['archived-sessions', [{ id: 'restore', title: 'Restore archived threads' }]],
    ['unmounted-plugin', [{ id: 'ghost', title: 'Archive ghost' }]],
    [
      'broken',
      [
        { id: 'twice', title: 'A' },
        { id: 'twice', title: 'B' },
      ],
    ],
  ]),
})

describe('searchSettings', () => {
  it('finds settings by title, description and key, never hidden ones, and counts them per page', () => {
    const result = SettingsSearch.search({ query: 'archive', sections, pages, entries: [] })
    expect(result.pages.map(hit => [hit.page.ns, hit.fields.map(field => field.key)])).toEqual([
      ['thread-sidebar', ['archiveUndoEnabled', 'autoArchiveEnabled']],
    ])
    expect(result.sections.map(section => section.id)).toEqual(['archived-sessions'])
    expect(result.total).toBe(3)
    expect([...result.counts]).toEqual([
      ['archived-sessions', 1],
      ['plugin:thread-sidebar', 2],
    ])
  })

  it('needs every word, matches page names and key paths, and ignores accents', () => {
    expect(SettingsSearch.search({ query: 'thread sidebar children', sections, pages, entries: [] }).pages[0]?.fields.map(field => field.key)).toEqual([
      'maxChildren',
    ])
    expect(SettingsSearch.search({ query: 'maxtabs', sections, pages, entries: [] }).total).toBe(1)
    expect(SettingsSearch.search({ query: 'preferences', sections, pages, entries: [] }).total).toBe(1)
    expect(SettingsSearch.search({ query: '   ', sections, pages, entries: [] }).total).toBe(0)
  })

  it('indexes every live section’s published entries by title, description, keywords and section name', () => {
    expect(entries.map(entry => [entry.sectionId, entry.id])).toEqual([
      ['general', 'developer-tools'],
      ['archived-sessions', 'restore'],
    ])
    expect(invalid).toEqual(['broken'])
    const result = SettingsSearch.search({ query: 'inspector', sections, pages, entries })
    expect(result.entries.map(entry => entry.id)).toEqual(['developer-tools'])
    expect(result.total).toBe(1)
    expect([...result.counts]).toEqual([['general', 1]])
    expect(SettingsSearch.search({ query: 'debugging general', sections, pages, entries }).entries.map(entry => entry.id)).toEqual(['developer-tools'])
  })

  it('counts a section’s name match and its entries together', () => {
    const result = SettingsSearch.search({ query: 'archive', sections, pages, entries })
    expect(result.entries.map(entry => entry.id)).toEqual(['restore'])
    expect(result.total).toBe(4)
    expect(result.counts.get('archived-sessions')).toBe(2)
    expect(SettingsSearch.matchEntries({ query: ' ', entries })).toEqual([])
  })
})
