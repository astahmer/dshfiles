import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { localizedTextReader, pluginSettingsPages } from './plugin-settings.js'
import { jsonValueSchema } from './schema-form/schema-model.js'
import { searchSettings } from './settings-search.js'

const wire = (schema: Schema) => jsonValueSchema.parse(schema.toJSON())

const pages = pluginSettingsPages({
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
  text: localizedTextReader('en'),
})
const sections = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'archived-sessions', order: 30, label: 'Archived threads' },
]

describe('searchSettings', () => {
  it('finds settings by title, description and key, never hidden ones, and counts them per page', () => {
    const result = searchSettings({ query: 'archive', sections, pages })
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
    expect(searchSettings({ query: 'thread sidebar children', sections, pages }).pages[0]?.fields.map(field => field.key)).toEqual(['maxChildren'])
    expect(searchSettings({ query: 'maxtabs', sections, pages }).total).toBe(1)
    expect(searchSettings({ query: 'preferences', sections, pages }).total).toBe(1)
    expect(searchSettings({ query: '   ', sections, pages }).total).toBe(0)
  })
})
