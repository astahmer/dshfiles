import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'
import { SettingsGroups } from './settings-groups.js'
import { SettingsTab, type SettingsViewProps } from './settings-view.js'

const t: ShellTranslate = (key, values) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`)
const rows = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'appearance', order: 10, label: 'Appearance' },
]
const sectionEntries = [{ sectionId: 'appearance', sectionLabel: 'Appearance', id: 'theme', title: 'Theme', description: 'Light or dark' }]

const mount = (overrides: Partial<SettingsViewProps>, section: ReactNode = null) => {
  const sectionOwners: unknown[] = []
  const renderSlot: ShellRenderSlot = (name, owner) => {
    if (name === 'settings.section') sectionOwners.push(owner)
    return name === 'settings.section' ? section : null
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

describe('settings view: one title per entry', () => {
  const entry = (view: { readonly host: HTMLElement }): HTMLElement | null => view.host.querySelector('[data-settings-entry]')
  const shown = (element: Element | null | undefined): boolean => element instanceof HTMLElement && element.style.display !== 'none'

  it('titles the entry with its own name and no group eyebrow above it', () => {
    const view = mount({ activeId: 'appearance' })
    const header = entry(view)?.querySelector('header')
    expect(header?.querySelector('h2')?.textContent).toBe('Appearance')
    expect(header?.textContent).toBe('Appearance')
    view.unmount()
  })

  it('hides the heading a section draws when it repeats the entry title, whatever its case', () => {
    const view = mount(
      { activeId: 'appearance' },
      <div>
        <h2 data-own-title="">APPEARANCE</h2>
        <p>Colours and fonts.</p>
      </div>,
    )
    expect(shown(entry(view)?.querySelector('[data-own-title]'))).toBe(false)
    expect(shown(entry(view)?.querySelector('header h2'))).toBe(true)
    expect(entry(view)?.textContent).toContain('Colours and fonts.')
    view.unmount()
  })

  it('keeps a section heading that says something else, and never hides a control', () => {
    const other = mount({ activeId: 'appearance' }, <h3 data-own-title="">Theme</h3>)
    expect(shown(entry(other)?.querySelector('[data-own-title]'))).toBe(true)
    other.unmount()
    const control = mount(
      { activeId: 'appearance' },
      <button data-own-title="" type="button">
        Appearance
      </button>,
    )
    expect(shown(entry(control)?.querySelector('[data-own-title]'))).toBe(true)
    control.unmount()
  })

  it('gives a merged plugin page a subheading, unless it would repeat the entry title', () => {
    const page = (ns: string, title: string): PluginSettingsPage => ({
      pageId: `plugin:${ns}`,
      ns,
      title,
      description: '',
      group: 'plugins',
      fields: [],
      modifiedPaths: [],
    })
    const headings: string[] = []
    const view = mount({
      groups: [
        {
          group: { id: 'general', label: 'General', description: '' },
          entries: [
            {
              id: 'appearance',
              group: 'general',
              label: 'Appearance',
              order: 0,
              sectionId: 'appearance',
              pages: [page('theme', 'appearance'), page('fonts', 'Fonts')],
              hiddenPages: [],
              keywords: '',
            },
          ],
        },
      ],
      renderPluginPage: (current, heading) => {
        headings.push(`${current.ns}:${heading}`)
        return null
      },
    })
    expect(headings).toEqual(['theme:none', 'fonts:section'])
    view.unmount()
  })
})

describe('settings view: narrow panes', () => {
  it('leaves the entry title to the Sections select when the navigation collapses into it', () => {
    const view = mount({ activeId: 'appearance' })
    const header = view.host.querySelector('[data-settings-entry] header')
    // The select right above already reads "Appearance": the heading stays for assistive technology only.
    expect(header?.className).toContain('dshx:@max-pane-compact:sr-only')
    expect(header?.querySelector('h2')?.textContent).toBe('Appearance')
    view.unmount()
  })
})

describe('settings view: search counts', () => {
  it('counts each matching setting once on its navigation row', () => {
    // SAFETY: search reads only the key, path, title and description of a field.
    const field = { key: 'maxTabs', path: ['maxTabs'], title: 'Max tabs', description: '', groups: [] } as unknown as SettingField
    const example: PluginSettingsPage = {
      pageId: 'plugin:example',
      ns: 'example',
      title: 'Example',
      description: '',
      group: 'plugins',
      fields: [field],
      modifiedPaths: [],
    }
    const view = mount({ groups: SettingsGroups.group({ sections: rows, pages: [example], panels: new Set() }), pluginPages: [example], query: 'max tabs' })
    expect(view.host.querySelector('[data-nav-id="plugin:example"]')?.textContent).toBe('Example1')
    view.unmount()
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
