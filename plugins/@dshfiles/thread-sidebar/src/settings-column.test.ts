import type { SettingsNavigationState } from '@dshfiles/settings-shell/settings-navigation'
import { describe, expect, it } from 'vitest'
import { SettingsColumn } from './settings-column.js'
import type { ResolvedEntry } from './sidebar-tree.js'

const page = (viewId: string, title: string): ResolvedEntry => ({ viewId, title, kind: 'page', keep: false, mapped: true, unmapped: false })

const state: SettingsNavigationState = {
  open: true,
  searching: false,
  activeId: 'general',
  groups: [
    {
      id: 'general',
      label: 'General',
      items: [
        { id: 'general', label: 'General' },
        { id: 'plugin:dshfiles-ui-styles', label: 'Appearance' },
      ],
    },
    { id: 'models', label: 'Models & accounts', items: [{ id: 'ai-accounts', label: 'AI accounts', page: 'ai-accounts' }, { id: 'models', label: 'Models' }] },
    { id: 'tools', label: 'Tools & MCP', items: [{ id: 'plugin:mcp-manager', label: 'MCP servers', page: 'mcp-servers' }] },
    {
      id: 'plugins',
      label: 'Plugins',
      items: [
        { id: 'plugins', label: 'Plugins' },
        { id: 'link:plugins', label: 'Installed plugins', page: 'plugins', linkOnly: true },
      ],
    },
  ],
}

const entries = [
  page('ai-accounts', 'AI accounts'),
  page('mcp-servers', 'MCP servers'),
  page('secret-catalog', 'Secrets'),
  page('plugins', 'Plugins'),
  page('dshfiles-capabilities-hub', 'Capabilities hub'),
]

describe('SettingsColumn (council round 4 B1: one Settings navigation)', () => {
  it('lists every category and every Settings page once', () => {
    const { groups, rest } = SettingsColumn.merge({ state, entries })
    const labels = groups.flatMap(group => group.rows.map(row => row.label))
    expect(labels).toEqual(['General', 'Appearance', 'AI accounts', 'Models', 'MCP servers', 'Plugins'])
    expect(new Set(labels).size).toBe(labels.length)
    // A page a category stands for opens from its row; one no category claims follows under Pages.
    expect(rest.map(entry => entry.title)).toEqual(['Secrets', 'Capabilities hub'])
  })

  it('opens the page a category stands for, and keeps that category reachable as its settings', () => {
    const rows = SettingsColumn.merge({ state, entries }).groups.flatMap(group => group.rows)
    const accounts = rows.find(row => row.label === 'AI accounts')
    expect(accounts?.page).toBe('ai-accounts')
    expect(accounts?.entry?.viewId).toBe('ai-accounts')
    expect(accounts?.category).toBe('ai-accounts')
    // Plugins: the category of that name takes the page; the category that only linked it adds no second row.
    const plugins = rows.find(row => row.label === 'Plugins')
    expect(plugins?.page).toBe('plugins')
    expect(rows.some(row => row.label === 'Installed plugins')).toBe(false)
    // A plain category opens in the Settings page.
    expect(rows.find(row => row.label === 'Appearance')?.page).toBeUndefined()
  })

  it('names a category that only links its page after that page', () => {
    const linkOnly: SettingsNavigationState = {
      ...state,
      groups: [{ id: 'plugins', label: 'Plugins', items: [{ id: 'link:plugins', label: 'Installed plugins', page: 'plugins', linkOnly: true }] }],
    }
    const rows = SettingsColumn.merge({ state: linkOnly, entries }).groups.flatMap(group => group.rows)
    expect(rows.map(row => [row.label, row.page])).toEqual([['Plugins', 'plugins']])
  })

  it('names every group but General, which its first row names', () => {
    const { groups } = SettingsColumn.merge({ state, entries })
    expect(groups.map(group => [group.label, group.named])).toEqual([
      ['General', false],
      ['Models & accounts', true],
      ['Tools & MCP', true],
      ['Plugins', true],
    ])
  })

  it('marks a category current while the Settings page shows it, a page row while its page shows', () => {
    const rows = SettingsColumn.merge({ state, entries }).groups.flatMap(group => group.rows)
    const general = rows.find(row => row.id === 'general')
    const accounts = rows.find(row => row.id === 'ai-accounts')
    if (general === undefined || accounts === undefined) throw new Error('rows missing')
    expect(SettingsColumn.isCurrent(general, { state, activePanelId: 'dshfiles-settings' })).toBe(true)
    expect(SettingsColumn.isCurrent(accounts, { state, activePanelId: 'dshfiles-settings' })).toBe(false)
    expect(SettingsColumn.isCurrent(accounts, { state, activePanelId: 'ai-accounts' })).toBe(true)
  })
})
