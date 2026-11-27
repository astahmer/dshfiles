import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import { SettingsGroups } from './settings-groups.js'
import { SettingsTab, type SettingsViewProps } from './settings-view.js'

const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)
const rows = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'appearance', order: 10, label: 'Appearance' },
]
const sectionEntries = [{ sectionId: 'appearance', sectionLabel: 'Appearance', id: 'theme', title: 'Theme', description: 'Light or dark' }]

const mount = (overrides: Partial<SettingsViewProps>) => {
  const sectionOwners: unknown[] = []
  const renderSlot: ShellRenderSlot = (name, owner) => {
    if (name === 'settings.section') sectionOwners.push(owner)
    return null
  }
  const onReveal = vi.fn()
  const props: SettingsViewProps = {
    groups: SettingsGroups.group({ sections: rows, pages: [], panels: new Set(['mcp-servers']) }),
    rows,
    shortcuts: [{ id: 'settings.open', label: 'Open Settings', aliases: ['preferences'], keys: ['⌘', ','] }],
    openPanel: vi.fn(),
    pluginPages: [],
    renderPluginPage: () => null,
    renderMatches: () => null,
    activeId: 'appearance',
    sectionEntries,
    sectionTarget: undefined,
    query: '',
    renderSlot,
    sectionOwner: { close: () => {} },
    t,
    onSelect: () => {},
    onReveal,
    onSearch: () => {},
    onClose: undefined,
    ...overrides,
  }
  const host = document.createElement('div')
  const container = document.createElement('div')
  document.body.append(host, container)
  const root = createRoot(container)
  act(() => root.render(<SettingsTab {...props} host={host} />))
  return { host, sectionOwners, onReveal, openPanel: props.openPanel, unmount: () => act(() => root.unmount()) }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('settings view: section entries', () => {
  it('lists matching entries under their section and reveals the picked one', () => {
    const view = mount({ query: 'dark' })
    const entry = view.host.querySelector<HTMLButtonElement>('[data-settings-result-entry="theme"]')
    expect(entry?.textContent).toContain('Theme')
    act(() => entry?.click())
    expect(view.onReveal).toHaveBeenCalledWith({ sectionId: 'appearance', target: 'theme' })
    expect(view.sectionOwners).toEqual([])
    view.unmount()
  })

  it('passes the target to the section only while Settings holds one', () => {
    const targeted = mount({ sectionTarget: 'theme' })
    expect(targeted.sectionOwners.at(-1)).toMatchObject({ target: 'theme' })
    targeted.unmount()
    const plain = mount({ sectionTarget: undefined })
    expect(plain.sectionOwners.at(-1)).not.toHaveProperty('target')
    plain.unmount()
  })
})

describe('settings view: one grouped page', () => {
  it('lists entries under task groups and opens a linked page from its entry', () => {
    const view = mount({ activeId: 'link:mcp-servers' })
    const groups = [...view.host.querySelectorAll('[data-settings-group]')].map(group => group.getAttribute('aria-label'))
    expect(groups).toEqual(['General', 'Tools & MCP', 'Other'])
    const open = [...view.host.querySelectorAll('button')].find(button => button.textContent?.includes('entry.open'))
    act(() => open?.click())
    expect(view.openPanel).toHaveBeenCalledWith('mcp-servers')
    view.unmount()
  })

  it('finds key bindings by command name and by keys', () => {
    const byName = mount({ query: 'open settings' })
    expect(byName.host.querySelector('[data-settings-shortcut="settings.open"]')?.textContent).toContain('Open Settings')
    byName.unmount()
    const byKeys = mount({ query: '⌘,' })
    expect(byKeys.host.querySelector('[data-settings-shortcut="settings.open"]')).not.toBeNull()
    byKeys.unmount()
  })
})

/** What a test drives from outside the mounted Settings view: opening an entry, typing a query. */
interface HarnessControls {
  open: (id: string) => void
  search: (query: string) => void
}

describe('settings view: origin filter', () => {
  const mountStateful = (initial: { readonly activeId: string; readonly query?: string }) => {
    const host = document.createElement('div')
    const container = document.createElement('div')
    document.body.append(host, container)
    const root = createRoot(container)
    const controls: HarnessControls = { open: () => {}, search: () => {} }
    const Harness = () => {
      const [activeId, setActiveId] = useState(initial.activeId)
      const [query, setQuery] = useState(initial.query ?? '')
      controls.open = setActiveId
      controls.search = setQuery
      return (
        <SettingsTab
          activeId={activeId}
          groups={SettingsGroups.group({ sections: rows, pages: [], panels: new Set(['mcp-servers']) })}
          host={host}
          onClose={undefined}
          onReveal={() => {}}
          onSearch={setQuery}
          onSelect={setActiveId}
          openPanel={() => {}}
          pluginPages={[]}
          query={query}
          renderMatches={() => null}
          renderPluginPage={() => null}
          renderSlot={() => null}
          rows={rows}
          sectionEntries={sectionEntries}
          sectionOwner={{ close: () => {} }}
          sectionTarget={undefined}
          shortcuts={[{ id: 'settings.open', label: 'Open Settings', aliases: ['preferences'], keys: ['⌘', ','] }]}
          t={t}
        />
      )
    }
    act(() => root.render(<Harness />))
    const pick = (option: 'all' | 'dsh' | 'plugin') =>
      act(() => host.querySelector<HTMLButtonElement>(`[data-settings-origin-filter] [data-origin-option="${option}"]`)?.click())
    const navButtons = () => [...host.querySelectorAll('nav button[data-nav-id]')].map(button => button.getAttribute('data-nav-id'))
    const shownEntry = () => host.querySelector('[data-settings-entry]')?.getAttribute('data-settings-entry')
    return { host, controls, pick, navButtons, shownEntry, unmount: () => act(() => root.unmount()) }
  }

  it('narrows the navigation and moves off an entry the filter hides', () => {
    const view = mountStateful({ activeId: 'general' })
    expect(view.host.querySelector('[data-origin-badge="dsh"]')).not.toBeNull()
    expect(view.navButtons()).toEqual(['general', 'link:mcp-servers', 'appearance'])
    expect(view.host.querySelector('[data-origin-option="dsh"]')?.textContent).toBe('origin.dsh1')
    expect(view.host.querySelector('[data-origin-option="plugin"]')?.textContent).toBe('origin.plugins2')

    view.pick('dsh')
    expect(view.navButtons()).toEqual(['general'])
    expect(view.shownEntry()).toBe('general')

    view.pick('plugin')
    expect(view.navButtons()).toEqual(['link:mcp-servers', 'appearance'])
    expect(view.shownEntry()).toBe('link:mcp-servers')
    expect(view.host.querySelector('[data-origin-badge="plugin"]')).not.toBeNull()
    view.unmount()
  })

  it('shows every entry again when an entry of the other origin is opened from elsewhere', () => {
    const view = mountStateful({ activeId: 'appearance' })
    view.pick('plugin')
    act(() => view.controls.open('general'))
    expect(view.shownEntry()).toBe('general')
    expect(view.navButtons()).toEqual(['general', 'link:mcp-servers', 'appearance'])
    expect(view.host.querySelector('[data-origin-option="all"]')?.getAttribute('aria-pressed')).toBe('true')

    act(() => view.host.querySelector<HTMLButtonElement>('nav button[data-nav-id="appearance"]')?.click())
    expect(view.shownEntry()).toBe('appearance')
    expect(view.navButtons()).toEqual(['general', 'link:mcp-servers', 'appearance'])
    expect(view.host.querySelector('[data-origin-option="all"]')?.getAttribute('aria-pressed')).toBe('true')
    view.unmount()
  })

  it('searches only the entries of the chosen origin', () => {
    const view = mountStateful({ activeId: 'general' })
    act(() => view.controls.search('settings'))
    expect(view.host.querySelector('[data-settings-shortcut="settings.open"]')).not.toBeNull()
    view.pick('plugin')
    expect(view.host.querySelector('[data-settings-shortcut="settings.open"]')).toBeNull()
    act(() => view.controls.search('dark'))
    expect(view.host.querySelector('[data-settings-result-entry="theme"]')).not.toBeNull()
    view.pick('dsh')
    expect(view.host.querySelector('[data-settings-result-entry="theme"]')).toBeNull()
    view.unmount()
  })
})
