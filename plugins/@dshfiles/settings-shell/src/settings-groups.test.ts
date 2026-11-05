import { describe, expect, it } from 'vitest'
import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'
import { JEV_ENTRY_ID, SettingsGroups } from './settings-groups.js'

const field = (key: string): SettingField =>
  // SAFETY: the grouping reads only key and path; the rest of the field shape belongs to the form renderer.
  ({ key, path: [key], title: key, description: '', groups: [] }) as unknown as SettingField

const page = (ns: string, title: string, keys: readonly string[], group: 'plugins' | 'more' = 'plugins'): PluginSettingsPage => ({
  pageId: `plugin:${ns}`,
  ns,
  title,
  description: '',
  group,
  fields: keys.map(field),
})

// The mounted web profile's sections and a cross-section of its namespaces (scratch DSH, 2026-11-04).
const sections = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'models', order: 10, label: 'Models' },
  { id: 'plugins', order: 15, label: 'Built-in plugins' },
  { id: 'agent-presets', order: 20, label: 'Agent presets' },
  { id: 'dshfiles-new-thread', order: 21, label: 'New thread' },
  { id: 'ai-accounts', order: 40, label: 'AI Accounts' },
  { id: 'thread-sidebar', order: 50, label: 'Thread sidebar' },
  { id: 'dshfiles-mcp-endpoint', order: 60, label: 'MCP endpoint' },
  { id: 'someone-elses', order: 99, label: 'Brand new section' },
]
const pages = [
  page('agent-loop', 'agent-loop', ['maxSteps']),
  page('ai-accounts', 'AI Accounts', ['distribution']),
  page('bash-sandbox', 'bash-sandbox', ['mode']),
  page('subagent-model-selection-settings', 'tool-subagent/model-selection-settings', ['model']),
  page('dshfiles-hmr-gate', 'Hmr gate', ['mode']),
  page('web', 'web', ['port']),
  page('dshfiles-backlog', 'Backlog', ['autoTriage', 'jevEnabled', 'jevSecret']),
  page('dshfiles-memory', 'Memory', ['jevEnabled', 'jevSecret']),
  page('thread-sidebar', 'Thread Sidebar', ['layoutMode', 'maxChildren']),
  page('secret-catalog', 'Secret catalog', ['scope']),
  page('ui-theme', 'ui-theme', ['theme'], 'more'),
  page('mystery-plugin', 'mystery-plugin', ['x']),
]
const panels = new Set(['ai-accounts', 'mcp-servers', 'secret-catalog', 'dshfiles-multi-host-hosts', 'plugins'])
const grouped = SettingsGroups.group({ sections, pages, panels })
const all = grouped.flatMap(group => group.entries.map(entry => ({ ...entry, groupId: group.group.id })))
const labels = all.map(entry => entry.label)

describe('settings groups', () => {
  it('lists the task groups of plan §4.6 in order, leaving out empty ones', () => {
    expect(grouped.map(group => group.group.label)).toEqual([
      'General',
      'Models & accounts',
      'Agents',
      'Tools & MCP',
      'Projects & workspaces',
      'Hosts & network',
      'Security',
      'Plugins',
      'Other',
    ])
  })

  it('places every section and page somewhere, unknown ones under Other', () => {
    for (const section of sections) expect(all.some(entry => entry.sectionId === section.id)).toBe(true)
    for (const current of pages) expect(SettingsGroups.entryFor(grouped, current.pageId)).toBeDefined()
    expect(all.filter(entry => entry.groupId === 'other').map(entry => entry.label)).toEqual(['Brand new section', 'Mystery plugin'])
  })

  it('titles pages for people, never with a package or row id', () => {
    for (const label of labels) expect(label).not.toMatch(/^[a-z0-9@][a-z0-9@/._-]*$/u)
    expect(labels).toEqual(expect.arrayContaining(['Agent loop', 'Shell sandbox', 'Subagent models', 'Plugin updates', 'Web server']))
  })

  it('shows AI accounts once: the section, its plugin settings and a link to the accounts page', () => {
    const accounts = all.filter(entry => /ai accounts/iu.test(entry.label))
    expect(accounts).toHaveLength(1)
    // Its section draws "Open AI Accounts" itself, so the entry adds no second link.
    expect(accounts[0]).toMatchObject({ groupId: 'models', sectionId: 'ai-accounts' })
    expect(accounts[0]?.link).toBeUndefined()
    const withoutSection = SettingsGroups.group({ sections: [], pages, panels }).flatMap(group => group.entries)
    expect(withoutSection.find(entry => entry.id === 'plugin:ai-accounts')?.link?.panelId).toBe('ai-accounts')
    expect(accounts[0]?.pages.map(current => current.ns)).toEqual(['ai-accounts'])
  })

  it('puts the frame layout status bar section in General', () => {
    const withStatusBar = SettingsGroups.group({
      sections: [...sections, { id: 'dshfiles-status-bar', order: 45, label: 'Status bar' }],
      pages,
      panels,
    }).flatMap(group => group.entries.map(entry => ({ ...entry, groupId: group.group.id })))
    expect(withStatusBar.find(entry => entry.sectionId === 'dshfiles-status-bar')).toMatchObject({ groupId: 'general', label: 'Status bar' })
  })

  it('links stage pages owned by other plugins only while they are loaded', () => {
    expect(all.find(entry => entry.id === 'link:mcp-servers')).toMatchObject({ groupId: 'tools', label: 'MCP servers' })
    expect(all.find(entry => entry.id === 'plugin:secret-catalog')).toMatchObject({
      groupId: 'security',
      label: 'Secrets',
      link: { panelId: 'secret-catalog' },
    })
    expect(all.find(entry => entry.id === 'link:dshfiles-multi-host-hosts')).toMatchObject({ groupId: 'hosts', label: 'Hosts' })
    const without = SettingsGroups.group({ sections, pages, panels: new Set() }).flatMap(group => group.entries)
    expect(without.some(entry => entry.link !== undefined)).toBe(false)
  })

  it('gathers every Jev setting in Tools & MCP and removes it from its plugin page', () => {
    const jev = all.find(entry => entry.id === JEV_ENTRY_ID)
    expect(jev).toMatchObject({ groupId: 'tools', label: 'Jev' })
    expect(jev?.pages.map(current => [current.ns, current.fields.map(each => each.key)])).toEqual([
      ['dshfiles-backlog', ['jevEnabled', 'jevSecret']],
      ['dshfiles-memory', ['jevEnabled', 'jevSecret']],
    ])
    expect(all.find(entry => entry.id === 'plugin:dshfiles-backlog')?.pages[0]?.fields.map(each => each.key)).toEqual(['autoTriage'])
    // Memory had only Jev settings: it has no page of its own left.
    expect(all.some(entry => entry.id === 'plugin:dshfiles-memory')).toBe(false)
    expect(SettingsGroups.entryForField(grouped, 'dshfiles-backlog', ['jevSecret'])?.id).toBe(JEV_ENTRY_ID)
    expect(SettingsGroups.entryForField(grouped, 'dshfiles-backlog', ['autoTriage'])?.id).toBe('plugin:dshfiles-backlog')
  })

  it('leads the Jev entry with the one shared key, titled Key, before the plugins that use it', () => {
    const withShared = SettingsGroups.group({
      sections,
      pages: [
        page('dshfiles-backlog', 'Backlog', ['autoTriage', 'jevEnabled']),
        page('dshfiles-memory', 'Memory', ['jevEnabled']),
        page('dshfiles-settings-shell', 'Settings shell', ['jevSecret']),
      ],
      panels,
    }).flatMap(group => group.entries)
    const jev = withShared.find(entry => entry.id === JEV_ENTRY_ID)
    expect(jev?.pages.map(current => [current.title, current.ns, current.fields.map(each => each.key)])).toEqual([
      ['Key', 'dshfiles-settings-shell', ['jevSecret']],
      ['Backlog', 'dshfiles-backlog', ['jevEnabled']],
      ['Memory', 'dshfiles-memory', ['jevEnabled']],
    ])
    expect(jev?.pages[0]?.description).toBe('One TypeSafe key for every Jev reader: Backlog triage and Memory signals.')
    // Settings' own page held only the key (its other fields are hidden), so it has no page of its own.
    expect(withShared.some(entry => entry.id === 'plugin:dshfiles-settings-shell')).toBe(false)
  })

  it('puts Layout in General and keeps the rest of the thread sidebar under Thread list', () => {
    const general = all.find(entry => entry.id === 'general')
    expect(general?.pages.map(current => [current.title, current.fields.map(each => each.key)])).toEqual([['Layout', ['layoutMode']]])
    const threadList = all.find(entry => entry.id === 'thread-sidebar')
    expect(threadList).toMatchObject({ label: 'Thread list', groupId: 'general' })
    expect(threadList?.pages[0]?.fields.map(each => each.key)).toEqual(['maxChildren'])
  })

  it('shows Notifications only once a section lands in it', () => {
    const withNotifications = SettingsGroups.group({
      sections: [...sections, { id: 'thread-notifications', order: 41, label: 'Thread notifications' }],
      pages,
      panels,
    })
    const notifications = withNotifications.find(group => group.group.id === 'notifications')
    expect(notifications?.entries.map(entry => [entry.id, entry.label])).toEqual([['thread-notifications', 'Thread notifications']])
    expect(grouped.some(group => group.group.id === 'notifications')).toBe(false)
  })

  it('keeps settings a native section draws searchable without a second row', () => {
    expect(all.some(entry => entry.pages.some(current => current.ns === 'ui-theme'))).toBe(false)
    expect(SettingsGroups.entryFor(grouped, 'plugin:ui-theme')?.id).toBe('general')
    expect(SettingsGroups.searchablePages(grouped).some(current => current.ns === 'ui-theme')).toBe(true)
  })
})
