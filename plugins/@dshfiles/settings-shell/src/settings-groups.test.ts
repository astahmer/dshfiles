// @vitest-environment node
// Pure placement logic, and the guard at the end reads the plugins' sources from disk.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  modifiedPaths: [],
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
  page('thread-sidebar', 'Thread Sidebar', ['maxChildren']),
  page('secret-catalog', 'Secret catalog', ['scope']),
  page('ui-theme', 'ui-theme', ['theme'], 'more'),
  page('mystery-plugin', 'mystery-plugin', ['x']),
]
const panels = new Set(['ai-accounts', 'mcp-servers', 'secret-catalog', 'dshfiles-multi-host-hosts', 'plugins'])
const grouped = SettingsGroups.group({ sections, pages, panels })
const all = grouped.flatMap(group => group.entries.map(entry => ({ ...entry, groupId: group.group.id })))
const labels = all.map(entry => entry.label)

describe('settings groups', () => {
  it('places the theme owner as General › Appearance right after the native General section', () => {
    const general = SettingsGroups.group({ sections, pages: [...pages, page('dshfiles-ui-styles', 'Ui styles', ['preset', 'uiFont'])], panels }).find(
      group => group.group.id === 'general',
    )
    expect(general?.entries.map(entry => entry.label).slice(0, 2)).toEqual(['General', 'Appearance'])
  })

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
    expect(labels).toEqual(expect.arrayContaining(['Agent loop', 'Shell sandbox', 'Subagent models', 'Plugin updates', 'Web search and fetch']))
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

  it('puts the frame layout status bar section in General › Layout', () => {
    const withStatusBar = SettingsGroups.group({
      sections: [...sections, { id: 'dshfiles-status-bar', order: 45, label: 'Status bar' }],
      pages,
      panels,
    }).flatMap(group => group.entries.map(entry => ({ ...entry, groupId: group.group.id })))
    // One block of General › Layout, under its own name.
    expect(withStatusBar.find(entry => entry.sectionId === 'dshfiles-status-bar')).toMatchObject({
      groupId: 'general',
      id: 'layout',
      label: 'Layout',
      sectionLabel: 'Status bar',
    })
  })

  it('puts the dshmarket section in Plugins, next to the built-in plugins it extends', () => {
    const withMarket = SettingsGroups.group({
      sections: [...sections, { id: 'market', order: 40, label: 'Plugin Market' }],
      pages,
      panels,
    }).flatMap(group => group.entries.map(entry => ({ ...entry, groupId: group.group.id })))
    expect(withMarket.find(entry => entry.sectionId === 'market')).toMatchObject({ groupId: 'plugins', label: 'Plugin Market' })
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

  it('keeps the thread sidebar under Thread list, with no Layout page in General (b:952m)', () => {
    const general = all.find(entry => entry.id === 'general')
    expect(general?.pages.some(current => current.title === 'Layout') ?? false).toBe(false)
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

// Every section and settings namespace of the default web profile, read from a scratch DSH on 2026-11-16.
const PROFILE_SECTIONS = [
  ['general', 'General'],
  ['thread-sidebar', 'Thread list'],
  ['dshfiles-status-bar', 'Status bar'],
  ['ai-accounts', 'AI accounts'],
  ['models', 'Models'],
  ['agent-presets', 'Agent presets'],
  ['dshfiles-mcp-endpoint', 'MCP endpoint'],
  ['dshfiles-network-access', 'Network access'],
  ['thread-notifications', 'Thread notifications'],
  ['plugins', 'Built-in plugins'],
  ['dshfiles-update-dsh', 'Update DSH'],
  ['dshfiles-workspace-folder-picker-projects', 'Projects'],
] as const
const PROFILE_NAMESPACES = [
  'dshfiles-ui-styles',
  'dshfiles-shortcuts',
  'thread-sidebar',
  'dshfiles-main-tabs',
  'dshfiles-workbench',
  'dshfiles-command-palette',
  'dshfiles-rich-composer',
  'queue-reorder',
  'dshfiles-turn-summary',
  'dshfiles-tool-meta',
  'dshfiles-annotations',
  'dshfiles-editor',
  'dshfiles-settings-shell',
  'ai-accounts',
  'dshfiles-model-effort-picker',
  'llm-deepseek-account',
  'ui-settings-account',
  'subagent',
  'subagent-model-selection-settings',
  'dshfiles-memory',
  'dshfiles-web-search-brave',
  'web-search-deepseek',
  'web-deepseek-api',
  'dshfiles-backlog',
  'jj-integration',
  'dshfiles-git-worktrees',
  'dshfiles-jujutsu',
  'dshfiles-test-runs',
  'dshfiles-preview',
  'web',
  'secret-catalog',
  'dshfiles-policies',
  'bash-sandbox',
  'session-log-deepseek',
  'dshfiles-agent-telemetry',
  'dshfiles-traces',
  'dshfiles-agent-plan',
  'dshfiles-background-jobs',
  'mcp-manager',
  'dshfiles-onboarding',
  'dshfiles-project-automations',
  'dshfiles-prompt-stash',
  'dshfiles-pull-requests',
  'dshfiles-session-undo',
  'dshfiles-sidebar-right',
  'dshfiles-web-fetch-readable',
  'dshfiles-worktree-memory',
] as const

const PROFILE_PANELS = new Set(['ai-accounts', 'mcp-servers', 'secret-catalog', 'dshfiles-multi-host-hosts', 'plugins', 'dshfiles-agents'])
const profile = SettingsGroups.group({
  sections: PROFILE_SECTIONS.map(([id, label], order) => ({ id, label, order })),
  // Listed last to first, so a page never joins its entry by the luck of the Host's order.
  pages: PROFILE_NAMESPACES.map(ns => page(ns, ns, ['example'])).toReversed(),
  panels: PROFILE_PANELS,
})
const entriesOf = (groupId: string): readonly string[] => profile.find(group => group.group.id === groupId)?.entries.map(entry => entry.label) ?? []
const profileEntry = (id: string) => profile.flatMap(group => group.entries).find(entry => entry.id === id)

describe('settings groups: the default profile', () => {
  it('leaves nothing under Other', () => {
    expect(entriesOf('other')).toEqual([])
  })

  it('keeps every group short enough to read at a glance', () => {
    expect(entriesOf('general')).toEqual(['General', 'Appearance', 'Keyboard shortcuts', 'Thread list', 'Layout', 'Composer', 'Transcript', 'Editor'])
    expect(entriesOf('models')).toEqual(['AI accounts', 'Models', 'Model picker', 'DeepSeek account'])
    expect(entriesOf('agents')).toEqual(['Agent definitions', 'Agent presets', 'Subagents', 'Background jobs', 'Memory'])
    expect(entriesOf('tools')).toEqual(['MCP servers', 'MCP endpoint', 'Web search and fetch'])
    expect(entriesOf('projects')).toEqual([
      'Projects',
      'Thread workspaces',
      'Repository history',
      'Checks and tests',
      'Preview and dev servers',
      'Backlog',
      'Pull requests',
      'Automations',
    ])
    expect(entriesOf('hosts')).toEqual(['Hosts', 'Network access'])
    expect(entriesOf('about')).toEqual(['Update DSH', 'Getting started', 'Diagnostics'])
    expect(entriesOf('security')).toEqual(['Secrets', 'Policies', 'Shell sandbox', 'Thread log sharing'])
    // 62 rows before the regroup (audit 2026-11-16).
    expect(profile.flatMap(group => group.entries)).toHaveLength(40)
  })

  it('puts Projects first in Projects & workspaces, the group a new user opens first', () => {
    expect(entriesOf('projects')[0]).toBe('Projects')
    expect(profileEntry('dshfiles-workspace-folder-picker-projects')?.group).toBe('projects')
  })

  it('gathers one task under one entry: layout, composer and transcript', () => {
    const layout = profileEntry('layout')
    expect(layout?.pages.map(current => current.title)).toEqual(['Main tabs', 'Docked panes', 'Thread panel'])
    expect(layout).toMatchObject({ label: 'Layout', sectionId: 'dshfiles-status-bar', sectionLabel: 'Status bar' })
    expect(profileEntry('composer')?.pages.map(current => current.title)).toEqual(['Composer', 'Message queue', 'Saved prompts'])
    expect(profileEntry('transcript')?.pages.map(current => current.title)).toEqual(['Turn summary', 'Tool details', 'Agent plan'])
    expect(profileEntry('plugin:jj-integration')?.pages.map(current => current.title)).toEqual(['Thread workspaces', 'Git worktrees', 'Undo a turn'])
    expect(profileEntry('link:mcp-servers')).toBeUndefined()
    expect(profileEntry('plugin:mcp-manager')).toMatchObject({ label: 'MCP servers', link: { panelId: 'mcp-servers' } })
  })

  it('opens a merged page, its section and its fields from their own ids', () => {
    expect(SettingsGroups.entryFor(profile, 'plugin:dshfiles-main-tabs')?.id).toBe('layout')
    expect(SettingsGroups.entryFor(profile, 'dshfiles-status-bar')?.id).toBe('layout')
    expect(SettingsGroups.entryForField(profile, 'dshfiles-main-tabs', ['example'])?.id).toBe('layout')
    expect(SettingsGroups.searchablePages(profile).map(current => current.ns)).toEqual(expect.arrayContaining([...PROFILE_NAMESPACES]))
  })

  it('names a task entry the same with one member loaded, and gives a page whose entry is absent its own row', () => {
    const small = SettingsGroups.group({
      sections: [],
      pages: [page('dshfiles-main-tabs', 'x', ['maxTabs']), page('dshfiles-git-worktrees', 'x', ['isolate'])],
      panels: new Set(),
    })
    expect(small.flatMap(group => group.entries.map(entry => [group.group.id, entry.id, entry.label]))).toEqual([
      ['general', 'layout', 'Layout'],
      ['projects', 'plugin:dshfiles-git-worktrees', 'Git worktrees'],
    ])
  })
})

type PluginSource = readonly [name: string, file: string, text: string]

/** Every non-test source file of the owned plugins. */
const pluginSources = (): readonly PluginSource[] => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  return readdirSync(root).flatMap(name => {
    const src = `${root}${name}/src`
    let files: readonly string[]
    try {
      files = readdirSync(src, { recursive: true, encoding: 'utf8' })
    } catch {
      return []
    }
    return files
      .filter(file => /\.tsx?$/u.test(file) && !/\.test\.|generated|\.d\.ts$/u.test(file))
      .map((file): PluginSource => [name, `plugins/@dshfiles/${name}/src/${file}`, readFileSync(`${src}/${file}`, 'utf8')])
  })
}

/** Ids a call site declares as a literal or through a constant of the same package, each with the file declaring it. */
const declaredIds = (sources: readonly PluginSource[], pattern: RegExp): ReadonlyArray<readonly [id: string, file: string]> =>
  sources.flatMap(([name, file, text]) =>
    [...text.matchAll(pattern)].flatMap((match): ReadonlyArray<readonly [string, string]> => {
      const constant = match[2]
      if (match[1] !== undefined) return [[match[1], file]]
      if (constant === undefined) return []
      const declaration = new RegExp(`const ${constant}\\s*=\\s*'([^']+)'`, 'u')
      const value = sources.filter(([owner]) => owner === name).flatMap(([, , candidate]) => declaration.exec(candidate)?.[1] ?? [])[0]
      return value === undefined ? [] : [[value, file]]
    }),
  )

const DECLARED_NAMESPACE = /defineSettings\(\{\s*namespace:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*))/gu
const DECLARED_SECTION = /name:\s*'settings\.section',\s*(?:registrant:\s*'[^']+',\s*)?id:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*))/gu
const GROUPS_FILE = 'plugins/@dshfiles/settings-shell/src/settings-groups.ts'

describe('settings groups: every owned plugin is placed', () => {
  const sources = pluginSources()

  it('finds the settings namespaces and sections the plugins declare', () => {
    const namespaces = declaredIds(sources, DECLARED_NAMESPACE).map(([id]) => id)
    expect(namespaces).toEqual(expect.arrayContaining(['dshfiles-main-tabs', 'dshfiles-ui-styles', 'thread-sidebar', 'jj-integration']))
    expect(namespaces.length).toBeGreaterThan(30)
    expect(declaredIds(sources, DECLARED_SECTION).map(([id]) => id)).toEqual(expect.arrayContaining(['general', 'thread-sidebar', 'dshfiles-status-bar']))
  })

  it('places every settings namespace in a task group, never under Other', () => {
    const unplaced = declaredIds(sources, DECLARED_NAMESPACE)
      .filter(([ns]) => SettingsGroups.groupOfNamespace(ns) === 'other')
      .map(
        ([ns, file]) =>
          `Settings namespace "${ns}" (${file}) has no task group, so its page would show under "Other". ` +
          `Add it to NAMESPACE_PLACEMENT in ${GROUPS_FILE}: a group and label of its own, or the entry of the task it belongs to.`,
      )
    expect(unplaced).toEqual([])
  })

  it('places every settings section in a task group, never under Other', () => {
    const unplaced = declaredIds(sources, DECLARED_SECTION)
      .filter(([id]) => SettingsGroups.groupOfSection(id) === 'other')
      .map(
        ([id, file]) => `Settings section "${id}" (${file}) has no task group, so it would show under "Other". Add it to SECTION_PLACEMENT in ${GROUPS_FILE}.`,
      )
    expect(unplaced).toEqual([])
  })
})
