import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { SettingsPluginPages } from './plugin-settings.js'
import { jsonValueSchema } from './schema-form/schema-model.js'

const wire = (schema: Schema) => jsonValueSchema.parse(schema.toJSON())

const text = SettingsPluginPages.localizedTextReader('en')

describe('pluginSettingsPages', () => {
  const namespaces = [
    { ns: 'dshfiles-main-tabs', schema: wire(Schema.object({ maxTabs: Schema.natural().default(12) })), autoGenerate: true },
    { ns: 'thread-sidebar', schema: wire(Schema.object({ dense: Schema.boolean() })), autoGenerate: true },
    { ns: 'ui-theme', schema: wire(Schema.object({ theme: Schema.string() })), autoGenerate: false },
    { ns: 'empty', schema: wire(Schema.object({ secret: Schema.string().role('secret') })), autoGenerate: true },
  ]

  it('titles pages by manifest label, then by id, and files native-owned namespaces under More settings', () => {
    const pages = SettingsPluginPages.pluginSettingsPages({
      namespaces,
      labels: new Map([['thread-sidebar', { title: 'Thread Sidebar', description: 'Group threads.' }]]),
      text,
    })
    expect(pages.map(page => [page.title, page.group, page.fields.length])).toEqual([
      ['Main tabs', 'plugins', 1],
      ['Thread Sidebar', 'plugins', 1],
      ['Ui theme', 'more', 1],
    ])
    expect(pages[1]?.description).toBe('Group threads.')
  })
})

describe('localizedTextReader', () => {
  it('picks the active language, then English', () => {
    expect(SettingsPluginPages.localizedTextReader('zh')({ en: 'Tabs', zh: '标签页' })).toBe('标签页')
    expect(SettingsPluginPages.localizedTextReader('fr')({ en: 'Tabs', zh: '标签页' })).toBe('Tabs')
    expect(text(42)).toBe('')
  })
})
