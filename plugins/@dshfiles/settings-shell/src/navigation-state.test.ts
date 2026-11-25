import { describe, expect, it } from 'vitest'
import { SettingsNavigationModel } from './navigation-state.js'
import { SettingsGroups } from './settings-groups.js'

const groups = SettingsGroups.group({
  sections: [
    { id: 'general', order: 0, label: 'General' },
    { id: 'ai-accounts', order: 40, label: 'AI Accounts' },
  ],
  pages: [],
  panels: new Set(['ai-accounts', 'mcp-servers', 'dshfiles-capabilities-hub']),
})

describe('settings navigation state (council round 4 B1)', () => {
  it('lists every category by group for the column, without the Pages group the column lists itself', () => {
    const state = SettingsNavigationModel.state({ groups, open: true, sectionId: undefined, counts: undefined })
    expect(groups.some(group => group.group.id === 'pages')).toBe(true)
    expect(state.groups.map(group => group.id)).not.toContain('pages')
    expect(state.groups[0]?.items[0]).toEqual({ id: 'general', label: 'General' })
  })

  it('names the page a category stands for: the one its section links itself, or its link', () => {
    const state = SettingsNavigationModel.state({ groups, open: true, sectionId: undefined, counts: undefined })
    const items = state.groups.flatMap(group => group.items)
    expect(items.find(item => item.id === 'ai-accounts')?.page).toBe('ai-accounts')
    expect(items.find(item => item.id === 'ai-accounts')?.linkOnly).toBeUndefined()
    const mcp = items.find(item => item.page === 'mcp-servers')
    expect(mcp?.linkOnly).toBe(true)
  })

  it('marks the category the page shows only while it shows, and none while searching', () => {
    expect(SettingsNavigationModel.state({ groups, open: true, sectionId: undefined, counts: undefined }).activeId).toBe('general')
    expect(SettingsNavigationModel.state({ groups, open: true, sectionId: 'ai-accounts', counts: undefined }).activeId).toBe('ai-accounts')
    expect(SettingsNavigationModel.state({ groups, open: false, sectionId: 'ai-accounts', counts: undefined }).activeId).toBeUndefined()
    const searching = SettingsNavigationModel.state({ groups, open: true, sectionId: undefined, counts: new Map([['general', 2]]) })
    expect(searching.activeId).toBeUndefined()
    expect(searching.searching).toBe(true)
    expect(searching.groups.flatMap(group => group.items).map(item => item.count)).toEqual([2, 0, 0])
  })
})
