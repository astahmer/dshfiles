import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'
import { SettingsGroups } from './settings-groups.js'
import { SettingsTab, type SettingsViewProps } from './settings-view.js'

const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')
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
    if (name === 'settings.header') return 'Settings'
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

describe('settings view: page header (council round 3 B3)', () => {
  it('titles the page with one h1 and a description, with search, Modified and the actions on a toolbar under it', () => {
    const view = mount({})
    const header = view.host.querySelector('[data-settings-page-header]')
    const heading = header?.querySelector('h1')
    expect(heading).not.toBeNull()
    expect(heading?.className).toContain('dshx:text-title')
    expect(header?.textContent).toContain('description')
    // The section label is printed once, as the entry heading, not as a second page title.
    expect(view.host.querySelectorAll('h1')).toHaveLength(1)
    const toolbar = view.host.querySelector('[data-settings-toolbar]')
    expect(toolbar?.querySelector('[role="searchbox"]')).not.toBeNull()
    expect(toolbar?.querySelector('[data-settings-modified-filter]')).not.toBeNull()
    // The header comes first, the toolbar under it; both end where the settings column (208 + the 720 form) ends.
    if (header == null || toolbar == null) throw new Error('Settings header or toolbar missing')
    expect(header.compareDocumentPosition(toolbar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(toolbar?.className).toContain('dshx:max-w-[928px]')
    expect(toolbar?.className).not.toContain('1088px')
    expect(toolbar?.className).not.toContain('1168px')
    view.unmount()
  })

  it('puts the header, the toolbar and the field column on the 720 form frame (round nine B1, kit A5)', () => {
    const view = mount({ columnNavigation: true })
    const column = view.host.querySelector('[data-settings-column]')?.className
    expect(column).toContain('dshx:max-w-form')
    expect(column).not.toContain('dshx:max-w-lane')
    expect(column).not.toContain('max-w-lane-wide')
    const toolbar = view.host.querySelector<HTMLElement>('[data-settings-toolbar]')
    expect(toolbar?.className).toContain('dshx:max-w-form')
    expect(toolbar?.className).not.toContain('dshx:max-w-lane')
    expect(view.host.querySelector('[data-settings-page-header]')?.className).toContain('dshx:max-w-form')
    // One 8px rhythm between the search, Modified and the action group.
    expect(toolbar?.className).toContain('dshx:gap-2')
    expect(toolbar?.className).not.toContain('dshx:gap-3')
    const search = toolbar?.querySelector('[role="searchbox"]')?.closest('[data-slot="input-group"]')
    expect(search?.className).toContain('dshx:h-8')
    expect(search?.className).not.toMatch(/max-w-\[560px\]/u)
    expect(view.host.querySelector('[data-settings-modified-filter]')?.className).toContain('dshx:h-8')
    // The configuration file's split button on the same 32px as the selects.
    expect(read('open-config-action.tsx')).toContain('dshx:inline-flex dshx:h-8 dshx:items-stretch')
    view.unmount()
  })

  it('labels every toolbar button 13/500 on 32px: Modified and Open configuration file read alike (council round 7 B7)', () => {
    const view = mount({ columnNavigation: true })
    const modified = view.host.querySelector('[data-settings-modified-filter]')?.className
    expect(modified).toContain('dshx:h-8')
    expect(modified).toContain('dshx:text-sm')
    expect(modified).toContain('dshx:font-medium')
    // One 13px line box, as the file action's: the toggle's 18.85px one set its label 0.92px high (measured in Chromium).
    expect(modified).toContain('dshx:leading-none')
    // The file action's label was 12px beside Modified's 13px, so Modified read heavier and sat a pixel high.
    expect(read('open-config-action.tsx')).toContain('dshx:px-2.5 dshx:text-sm dshx:leading-none dshx:font-medium')
    expect(read('open-config-action.tsx')).not.toContain('dshx:px-2.5 dshx:text-xs dshx:font-medium')
    view.unmount()
  })
})

describe('settings view: the page title names the category (council round 7 B2)', () => {
  it('titles the page with the open category, not "Settings", beside the side column', () => {
    const view = mount({ columnNavigation: true, activeId: 'general' })
    expect(view.host.querySelector('[data-settings-page-header] h1')?.textContent).toBe('General')
    view.unmount()
    const appearance = mount({ columnNavigation: true, activeId: 'appearance' })
    expect(appearance.host.querySelector('[data-settings-page-header] h1')?.textContent).toBe('Appearance')
    // The section is still Settings for assistive technology.
    expect(appearance.host.querySelector('[data-settings-view]')?.getAttribute('aria-label')).toBe('title')
    appearance.unmount()
  })

  it('marks the title with the Settings rail glyph in the settings tone (council round 7 B6)', () => {
    const view = mount({ columnNavigation: true, activeId: 'general' })
    const mark = view.host.querySelector('[data-settings-page-header] [data-slot="page-title-mark"]')
    expect(mark?.className).toContain('dshx:text-nav-settings')
    expect(mark?.querySelector('svg')?.getAttribute('class')).toContain('lucide-settings')
    view.unmount()
  })

  it('titles the search results "Settings": they span every category', () => {
    const view = mount({ columnNavigation: true, activeId: 'general', query: 'dark' })
    expect(view.host.querySelector('[data-settings-page-header] h1')?.textContent).toBe('Settings')
    view.unmount()
  })

  it('keeps "Settings" for the phone category list, which shows no category', () => {
    const view = mount({ activeId: undefined, onBack: () => {} })
    const heading = view.host.querySelector('[data-settings-page-header] h1')
    expect(heading?.querySelector('.dshx\\:\\@max-pane-compact\\:hidden')?.textContent).toBe('General')
    expect(heading?.querySelector('.dshx\\:\\@max-pane-compact\\:inline')?.textContent).toBe('Settings')
    view.unmount()
  })
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

describe('settings view: search focus', () => {
  const frames = (count: number) =>
    act(async () => {
      for (let index = 0; index < count; index += 1) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })

  it('focuses its search field once the stage shows the page, when focus fell to body', async () => {
    // The stage mounts the page into a host it still hides: the field cannot take focus until it shows.
    let hidden = true
    const focus = HTMLElement.prototype.focus
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (!hidden) focus.call(this, options)
    })
    const view = mount({})
    expect(document.activeElement).toBe(document.body)
    hidden = false
    await frames(3)
    expect(document.activeElement).toBe(view.host.querySelector('[role="searchbox"]'))
    spy.mockRestore()
    view.unmount()
  })

  it('leaves the search field unfocused on a touch screen, so no keyboard covers the page (round five B7)', async () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('matchMedia', matchMedia)
    const view = mount({})
    await frames(3)
    const search = view.host.querySelector('[role="searchbox"]')
    expect(document.activeElement).not.toBe(search)
    expect(search?.hasAttribute('data-modal-autofocus')).toBe(false)
    view.unmount()
    vi.unstubAllGlobals()
  })

  it('leaves focus where the user put it', async () => {
    const rail = document.createElement('button')
    document.body.append(rail)
    rail.focus()
    const view = mount({})
    // autoFocus took it on mount; the user moves on before the page shows.
    rail.focus()
    await frames(3)
    expect(document.activeElement).toBe(rail)
    view.unmount()
  })
})

describe('settings view: one title per entry', () => {
  const entry = (view: { readonly host: HTMLElement }): HTMLElement | null => view.host.querySelector('[data-settings-entry]')
  const shown = (element: Element | null | undefined): boolean => element instanceof HTMLElement && element.style.display !== 'none'

  it('titles every entry with the one contextual heading, 15/20 at 600 (council round 4 B5)', () => {
    const view = mount({ activeId: 'appearance' })
    const heading = entry(view)?.querySelector('h2')
    expect(heading?.className).toContain('dshx:text-heading')
    expect(heading?.className).not.toContain('dshx:text-sm')
    expect(heading?.className).not.toContain('dshx:text-title')
    view.unmount()
  })

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

  it('leaves a whole-entry page title to the side column row that names it (council round 4 B1)', () => {
    const page: PluginSettingsPage = { pageId: 'plugin:dshfiles-ui-styles', ns: 'dshfiles-ui-styles', title: 'Appearance', description: '', group: 'plugins', fields: [], modifiedPaths: [] }
    const groups = [
      {
        group: { id: 'general' as const, label: 'General', description: '' },
        entries: [{ id: page.pageId, group: 'general' as const, label: 'Appearance', order: 0, pages: [page], hiddenPages: [], keywords: '' }],
      },
    ]
    const headings: string[] = []
    const renderPluginPage = (_page: PluginSettingsPage, heading: string): null => {
      headings.push(heading)
      return null
    }
    mount({ groups, activeId: page.pageId, renderPluginPage }).unmount()
    mount({ groups, activeId: page.pageId, renderPluginPage, columnNavigation: true }).unmount()
    // The page h1 names the entry in either layout (council round 7 B2).
    expect(headings).toEqual(['named', 'named'])
  })
})

describe('settings view: narrow panes', () => {
  it('leaves the entry title to the Sections select when the navigation collapses into it', () => {
    const view = mount({ activeId: 'appearance' })
    const header = view.host.querySelector('[data-settings-entry] header')
    // The page h1 already reads "Appearance": the heading stays for assistive technology only.
    expect(header?.className).toBe('dshx:sr-only')
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

describe('settings view: Jev pointer', () => {
  const jevField = (key: string): SettingField =>
    // SAFETY: grouping reads only the key and path of a field.
    ({ key, path: [key], title: key, description: '', groups: [] }) as unknown as SettingField
  const page = (ns: string, keys: readonly string[]): PluginSettingsPage => ({
    pageId: `plugin:${ns}`,
    ns,
    title: ns,
    description: '',
    group: 'plugins',
    fields: keys.map(jevField),
    modifiedPaths: [],
  })
  const groups = SettingsGroups.group({
    sections: [...rows, { id: 'dshfiles-update-dsh', order: 20, label: 'Update DSH' }],
    pages: [page('dshfiles-settings-shell', ['releaseCheck', 'jevSecret']), page('dshfiles-backlog', ['autoTriage', 'jevEnabled'])],
    panels: new Set(),
  })
  const note = (view: { readonly host: HTMLElement }): string | undefined => view.host.querySelector('[role="note"]')?.textContent ?? undefined

  it('points a plugin page at the Jev entry that holds its Jev settings', () => {
    const view = mount({ groups, activeId: 'plugin:dshfiles-backlog' })
    expect(note(view)).toContain('entry.jevMoved')
    view.unmount()
  })

  it('says nothing on the page whose namespace only lends the shared key', () => {
    const view = mount({ groups, activeId: 'dshfiles-update-dsh' })
    expect(note(view)).toBeUndefined()
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

  it('lists the Settings pages it does not otherwise reach in a Pages group whose rows open them (round five B1)', () => {
    const panels = new Set(['mcp-servers', 'secret-catalog', 'plugins', 'dshfiles-capabilities-hub', 'dshfiles-plugin-guide'])
    const view = mount({ groups: SettingsGroups.group({ sections: rows, pages: [], panels }) })
    const pages = view.host.querySelector('[data-settings-group="pages"]')
    // Secrets and Installed plugins are linked entries of their own groups, so they are not listed twice.
    expect([...(pages?.querySelectorAll('[data-nav-id]') ?? [])].map(row => row.textContent)).toEqual(['Capabilities hub', 'Plugin guide'])
    act(() => pages?.querySelector<HTMLButtonElement>('[data-nav-id="page:dshfiles-plugin-guide"]')?.click())
    expect(view.openPanel).toHaveBeenCalledWith('dshfiles-plugin-guide')
    view.unmount()
  })

  it('prints no General group label above the General entry: one General, not three', () => {
    const view = mount({})
    const general = view.host.querySelector('[data-settings-group="general"]')
    expect(general?.getAttribute('aria-label')).toBe('General')
    expect([...(general?.children ?? [])].filter(child => child.textContent === 'General' && !child.hasAttribute('data-nav-id'))).toEqual([])
    expect(view.host.querySelector('[data-settings-group="other"]')?.firstElementChild?.textContent).toBe('Other')
    // The open category: the quiet selected wash, its leading marker and a 550 label (round five A1).
    const open = view.host.querySelector('[data-nav-id][aria-current="page"]')
    expect(open?.className).toContain('dshx:selected-marker')
    expect(open?.className).toContain('dshx:font-selected')
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

describe('settings view: phone toolbar (council round 4 B3, round five B6)', () => {
  it('gives the search and the file menu one 44px row in a narrow pane, with Modified as the search field\'s filter', () => {
    const view = mount({})
    const search = view.host.querySelector('[data-settings-toolbar] [role="searchbox"]')?.closest('[data-slot="input-group"]')
    expect(search?.className).toContain('dshx:@max-pane-compact:h-11')
    // The toolbar's Modified toggle leaves a narrow pane; the field's own filter button takes its place.
    expect(view.host.querySelector('[data-settings-modified-filter]')?.className).toContain('dshx:@max-pane-compact:hidden')
    const inline = search?.querySelector<HTMLElement>('[data-settings-modified-inline]')
    expect(inline?.getAttribute('aria-label')).toBe('search.modified')
    expect(inline?.getAttribute('aria-pressed')).toBe('false')
    expect(inline?.className).toContain('dshx:@max-pane-compact:inline-flex')
    expect(read('open-config-action.tsx')).toContain('dshx:shadow-xs dshx:@max-pane-compact:h-11')
    expect(read('open-config-action.tsx')).toContain('dshx:@max-pane-compact:w-11')
    view.unmount()
  })
})

describe('settings view: surface roles (round five B5)', () => {
  it('puts the page on the stage surface, beside the navigation column on the nav surface', () => {
    const view = mount({})
    expect(view.host.querySelector('[data-settings-view]')?.className).toContain('dshx:surface-stage')
    expect(view.host.querySelector('[data-settings-view]')?.className).not.toContain('--dsw-alias-bg-layer-1')
    view.unmount()
  })
})

describe('settings view: phone drill-down (round five B6)', () => {
  it('opens on the grouped category list in a narrow pane, with no Sections dropdown', () => {
    const onSelect = vi.fn()
    const view = mount({ activeId: undefined, onBack: () => {}, onSelect })
    expect(view.host.querySelector('[role="combobox"]')).toBeNull()
    const root = view.host.querySelector<HTMLElement>('[data-settings-root]')
    expect(root?.className).toContain('dshx:@max-pane-compact:flex')
    expect(root?.className).toContain('dshx:hidden')
    // 44px rows with a 28px identity tile and a chevron; the first group is named by its first row.
    const row = root?.querySelector<HTMLElement>('[data-settings-root-row="appearance"]')
    expect(row?.className).toContain('dshx:h-11')
    expect(row?.querySelector('[data-settings-tile]')?.className).toContain('dshx:size-7')
    expect(row?.textContent).toBe('Appearance')
    expect(root?.querySelector('[data-settings-group="general"] h3')).toBeNull()
    // The fields wait for a pick in a narrow pane; a wide pane still shows the first category.
    expect(view.host.querySelector('[data-settings-column]')?.className).toContain('dshx:@max-pane-compact:hidden')
    act(() => row?.click())
    expect(onSelect).toHaveBeenCalledWith('appearance')
    view.unmount()
  })

  it('draws each group as a card with 1px separators from the label column, none after the last row (round nine B7, B4)', () => {
    const view = mount({ activeId: undefined, onBack: () => {} })
    const card = view.host.querySelector<HTMLElement>('[data-settings-root-card]')
    // No full-width dividers: an inset rule on every row but the first, from the label column (11 + 28 + 12 = 51px).
    expect(card?.className).not.toContain('dshx:divide-y')
    // A lighter outer edge than the separators.
    expect(card?.className).toContain('dshx:border-(--dsw-alias-border-l2)')
    expect(card?.className).not.toContain('dshx:border-border')
    const rows = [...view.host.querySelectorAll<HTMLElement>('[data-settings-root-row]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.className).toContain('dshx:not-first:before:left-[51px]')
      expect(row.className).toContain('dshx:not-first:before:h-px')
      expect(row.className).toContain('dshx:not-first:before:bg-border')
      // The phone gutter (round nine B4): the card fills from 12px, its tiles start at 24px (1px edge + 11px).
      expect(row.className).toContain('dshx:px-[11px]')
    }
    // Group heads on the 24px text edge.
    expect(view.host.querySelector('[data-settings-root] h3')?.className).toContain('dshx:px-3')
    view.unmount()
  })

  it('shows a picked category under one Back row, without the search toolbar, and Back returns to the list', () => {
    const onBack = vi.fn()
    const view = mount({ activeId: 'appearance', onBack })
    expect(view.host.querySelector('[data-settings-root]')).toBeNull()
    const back = view.host.querySelector<HTMLElement>('[data-settings-back-row]')
    expect(back?.className).toContain('dshx:@max-pane-compact:grid')
    expect(back?.querySelector('h2')?.textContent).toBe('Appearance')
    expect(view.host.querySelector('[data-settings-toolbar]')?.parentElement?.className).toContain('dshx:@max-pane-compact:hidden')
    act(() => back?.querySelector<HTMLElement>('button[aria-label="nav.back"]')?.click())
    expect(onBack).toHaveBeenCalledOnce()
    view.unmount()
  })
})

describe('settings view: one Settings navigation (council round 4 B1)', () => {
  it('drops its own category list and the entry title the column names while the side column draws the list', () => {
    const view = mount({ columnNavigation: true, activeId: 'general' })
    expect(view.host.querySelector('nav[aria-label="title"]')).toBeNull()
    expect(view.host.querySelector('[data-nav-id]')).toBeNull()
    // The entry title stays for screen readers; the column's current row names it on screen.
    expect(view.host.querySelector('[data-settings-entry="general"] header')?.className).toBe('dshx:sr-only')
    // The page header and the toolbar stay.
    expect(view.host.querySelector('[data-settings-page-header] h1')).not.toBeNull()
    expect(view.host.querySelector('[data-settings-toolbar] [role="searchbox"]')).not.toBeNull()
    view.unmount()
  })

  it('keeps its own list without a column (a docked pane, no thread sidebar)', () => {
    const view = mount({ activeId: 'general' })
    expect(view.host.querySelector('nav[aria-label="title"]')).not.toBeNull()
    expect(view.host.querySelector('[data-settings-entry="general"] header')?.className).toBe('dshx:sr-only')
    view.unmount()
  })
})
