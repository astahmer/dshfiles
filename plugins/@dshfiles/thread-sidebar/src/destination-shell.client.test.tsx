import { readFileSync } from 'node:fs'
// @vitest-environment jsdom
import { ListHeaderExtras } from './list-header-extras.js'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSelection, DestinationShell, PHONE_TAB_PILL, type DestinationShellProps } from './destination-shell.js'
import { MovedTo, MovedToDialog } from './moved-to-dialog.js'
import type { SettingsNavigationService, SettingsNavigationState } from '@dshfiles/settings-shell/settings-navigation'

/** frame-layout's phone status button (council round 3 B6): absent unless a test provides it. */
type PhoneStatusStub = { Button: (() => JSX.Element) | undefined }
const phoneStatus: PhoneStatusStub = { Button: undefined }
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useContract: () => (phoneStatus.Button === undefined ? { status: 'inactive' } : { status: 'active', value: { Button: phoneStatus.Button } }),
}))

const panels = [
  { id: 'dshfiles-thread-board', label: 'Thread Sidebar: Board', order: 2 },
  { id: 'dshfiles-usage', label: 'Usage: Analytics', order: 4 },
  { id: 'traces', label: 'Traces: Explorer', order: 4 },
  { id: 'plugins', label: 'Plugins', order: 0 },
]

const setPhone = (phone: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: phone, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
}

const props = (overrides: Partial<DestinationShellProps> = {}): DestinationShellProps => ({
  panels,
  contributed: [],
  activePanelId: null,
  selectedThreadId: null,
  collapsed: false,
  renderPanelIcon: () => null,
  threadList: <div>Thread list</div>,
  selectPanel: vi.fn(),
  startSession: vi.fn(),
  searchThreads: vi.fn(),
  showNewThread: true,
  labels: { newThread: 'New thread', searchThreads: 'Search threads' },
  openSettings: vi.fn(),
  toggleSidebar: vi.fn(),
  record: vi.fn(),
  ...overrides,
})

/** Settings' category list as `@dshfiles/settings-shell` provides it (council round 4 B1). */
const settingsState: SettingsNavigationState = {
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
    { id: 'models', label: 'Models & accounts', items: [{ id: 'ai-accounts', label: 'AI accounts', page: 'ai-accounts' }] },
    { id: 'plugins', label: 'Plugins', items: [{ id: 'link:plugins', label: 'Plugins', page: 'plugins', linkOnly: true }] },
  ],
}

const navigationOf = (state: SettingsNavigationState) => {
  const release = vi.fn()
  return {
    state: { get: () => state, subscribe: () => () => undefined },
    select: vi.fn(),
    attach: vi.fn(() => release),
    release,
  } satisfies SettingsNavigationService & { readonly release: () => void }
}

const renderShell = (overrides: Partial<DestinationShellProps> = {}) => {
  const shell = props(overrides)
  render(
    <TooltipProvider>
      <DestinationShell {...shell} />
    </TooltipProvider>,
  )
  return shell
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Element.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  DestinationSelection.set('threads')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('DestinationShell', () => {
  it('shows a labelled rail, the thread list for Threads and a section index elsewhere', () => {
    setPhone(false)
    const shell = renderShell()
    const rail = screen.getByRole('tablist', { name: 'Destinations' })
    expect(
      within(rail)
        .getAllByRole('tab')
        .map(tab => tab.textContent),
    ).toEqual(['Threads', 'Inbox', 'Land', 'Work', 'Agents', 'Observe', 'Knowledge', ''])
    // The bottom cluster is glyphs only, like New folder and the rail actions beside it (council round 4 B6).
    expect(within(rail).getByRole('tab', { name: 'Settings' }).querySelector('[data-rail-icon] + span')).toBeNull()
    // Labels at the 11px floor, -0.01em, in a 60px rail (round five B3).
    expect(within(rail).getByText('Knowledge').className).toContain('dshx:text-2xs')
    expect(within(rail).getByText('Knowledge').className).not.toContain('dshx:text-[10.5px]')
    expect(within(rail).getByText('Knowledge').className).toContain('dshx:tracking-[-0.01em]')
    expect(screen.getByRole('navigation', { name: 'Destinations' }).className).toContain('dshx:w-15')
    // One hairline between the labelled destinations and the glyph-only bottom cluster.
    expect(rail.querySelector('[data-rail-divider]')?.className).toContain('dshx:border-t')
    expect(screen.getByText('Thread list')).toBeTruthy()
    // Productivity pass Q5 (T5.3): the Threads pages (Board) are items of the list's Filter menu, published through
    // ListHeaderExtras rather than drawn as buttons above the list.
    expect(screen.queryByRole('navigation', { name: 'Threads pages' })).toBeNull()
    const sections = ListHeaderExtras.get().sections
    expect(sections.map(section => section.label)).toEqual(['Board'])
    act(() => sections[0]?.open())
    expect(shell.selectPanel).toHaveBeenCalledWith('dshfiles-thread-board')
    expect(shell.record).toHaveBeenCalledWith({ destination: 'threads', section: 'dshfiles-thread-board', surface: 'index' })
    expect(screen.queryByRole('button', { name: 'New thread' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search threads' }))
    expect(shell.searchThreads).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Observe' }))
    expect(shell.record).toHaveBeenCalledWith({ destination: 'observe', surface: 'rail' })
    const pages = screen.getByRole('navigation', { name: 'Observe pages' })
    expect(
      within(pages)
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Usage', 'Traces'])
    fireEvent.click(screen.getByRole('button', { name: 'Traces' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('traces')
    expect(shell.record).toHaveBeenCalledWith({ destination: 'observe', section: 'traces', surface: 'index' })
  })

  it('lists pages for plugin authors in a Developer group at the end of Settings, which one setting hides', () => {
    setPhone(false)
    const developerPanels = [
      ...panels,
      { id: 'component-gallery', label: 'Component gallery', order: 90 },
      { id: 'dshfiles-plugin-guide', label: 'Plugin guide', order: 8 },
    ]
    renderShell({ panels: developerPanels })
    fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }))
    expect(screen.queryByRole('button', { name: 'Component gallery' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    const pages = within(screen.getByRole('navigation', { name: 'Settings pages' }))
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))
    expect(pages).toEqual(['All settings', 'Plugins'])
    const developer = screen.getByRole('region', { name: 'Developer' })
    expect(
      within(developer)
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Component gallery', 'Plugin guide'])
    // The group follows everything a user came for.
    expect(screen.getByRole('navigation', { name: 'Settings pages' }).compareDocumentPosition(developer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Council round 8 B4: no grey group; its rows keep their own icons, drawn in the Developer tone.
    for (const button of within(developer).getAllByRole('button', { name: /^(?:Component gallery|Plugin guide)$/u }))
      expect(button.querySelector('[data-section-icon] [data-settings-glyph]')?.getAttribute('data-settings-glyph')).toBe('developer')
    // Round nine B1: its head is a Settings group head like the others, at their indent and 16px under the group above,
    // with no rule of its own.
    expect(developer.className).not.toContain('dshx:border-t')
    expect(developer.className).toContain('dshx:mt-4')
    expect(developer.querySelector('h3')?.className).toBe('dshx:px-2.5 dshx:pb-1 dshx:text-sm dshx:font-semibold dshx:text-muted-foreground')
    cleanup()
    DestinationSelection.set('settings')
    renderShell({ panels: developerPanels, showDeveloperPages: false })
    expect(screen.queryByRole('region', { name: 'Developer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Component gallery' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeTruthy()
  })

  it('lists page names only, under one line that describes the destination (round five B1)', () => {
    setPhone(false)
    renderShell()
    fireEvent.click(screen.getByRole('tab', { name: 'Observe' }))
    const usage = screen.getByRole('button', { name: 'Usage' })
    expect(usage.getAttribute('aria-describedby')).toBeNull()
    expect(usage.textContent).toBe('Usage')
    expect(document.querySelectorAll('[data-destination-index="observe"] header p')).toHaveLength(1)
  })

  it('lights the current place once: a toned tile on the rail item, the wash and marker on the open page (council round 3 B2)', () => {
    setPhone(false)
    renderShell({ activePanelId: 'dshfiles-usage', renderPanelIcon: () => <svg data-testid="page-icon" /> })
    fireEvent.click(screen.getByRole('tab', { name: 'Observe' }))
    const tab = screen.getByRole('tab', { name: 'Observe' })
    // The rail item: its identity tone's 14% tile behind the glyph and an ink label at 600, no wash and no marker.
    expect(tab.className).toContain('dshx:nav-tone-observe')
    expect(tab.className).not.toContain('dshx:bg-selected-wash')
    expect(tab.className).not.toContain('dshx:selected-marker')
    expect(within(tab).getByText('Observe').className).toContain('dshx:font-semibold')
    expect(tab.className).toContain('dshx:text-foreground')
    expect(tab.className).not.toMatch(/(^| )dshx:bg-accent( |$)/u)
    expect(tab.querySelector('[data-rail-icon]')?.className).toContain('dshx:bg-nav-tile')
    // Every destination glyph draws in its own tone; only the active one gets the tile.
    const threads = screen.getByRole('tab', { name: 'Threads' })
    expect(threads.className).toContain('dshx:nav-tone-threads')
    expect(threads.querySelector('[data-rail-icon]')?.className).toContain('dshx:text-nav-tone')
    expect(threads.querySelector('[data-rail-icon]')?.className).not.toContain('dshx:bg-nav-tile')
    // The open page: the neutral wash and the marker; its glyph carries the destination's tone on that tone's 14% tile
    // (round nine B2, kit A1), the selected-place seat that follows the row's aria-current.
    const usage = screen.getByRole('button', { name: 'Usage' })
    expect(usage.className).toContain('dshx:bg-selected-wash')
    expect(usage.className).toContain('dshx:selected-marker')
    // A glyph-led row draws no pill, so the kit's selected edge outlines its wash (council round 12 B1).
    expect(usage.className).toContain('dshx:selected-edge')
    const seat = usage.querySelector<HTMLElement>('[data-section-icon]')
    expect(seat?.className).toContain('dshx:place-seat')
    expect(seat?.className).toContain('dshx:nav-tone-observe')
    expect(seat?.className).not.toContain('dshx:text-control-on')
    // A 24px seat on the 16px glyph's footprint, so selecting a row never moves it.
    expect(seat?.className).toContain('dshx:size-6 dshx:-mx-1 dshx:-mt-0.5 dshx:-mb-1')
    const traces = screen.getByRole('button', { name: 'Traces' })
    expect(traces.className).not.toContain('dshx:bg-selected-wash')
    // At rest a row's glyph stays in the secondary ink, with no tile.
    const quiet = traces.querySelector<HTMLElement>('[data-section-icon]')
    expect(quiet?.className).not.toContain('dshx:nav-tone-observe')
    expect(quiet?.style.getPropertyValue('--dshx-nav-tone')).toBe('var(--dsw-alias-label-secondary)')
  })

  it('sizes every side-column glyph by its seat and draws Review with the Land glyph its tab shows (council round 10 B2)', () => {
    setPhone(false)
    DestinationSelection.set('land')
    // A page that registers a bare lucide icon (24px by default), as diffs-review does.
    const unsized = (panelId: string) => (
      <svg data-registered-glyph={panelId} width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
      </svg>
    )
    renderShell({
      panels: [
        ...panels,
        { id: 'jj-integration', label: 'JJ Integration: Thread integration', order: 1 },
        { id: 'diffs-review', label: 'Review', order: 2 },
      ],
      activePanelId: 'diffs-review',
      renderPanelIcon: unsized,
    })
    const review = screen.getByRole('button', { name: 'Review' })
    const seat = review.querySelector<HTMLElement>('[data-section-icon]')
    expect(seat?.className).toContain('dshx:[&_svg]:size-4')
    // The Land glyph, not the page's registered one: the row and its tab name the page alike.
    expect(seat?.querySelector('[data-registered-glyph]')).toBeNull()
    expect(seat?.querySelector('svg')?.getAttribute('class')).toContain('lucide-git-merge')
    // Every other row keeps its own glyph, sized by the seat.
    const workspaces = screen.getByRole('button', { name: 'Workspaces' }).querySelector<HTMLElement>('[data-section-icon]')
    expect(workspaces?.querySelector('[data-registered-glyph="jj-integration"]')).not.toBeNull()
    expect(workspaces?.className).toContain('dshx:[&_svg]:size-4')
  })

  it('marks a side-column row\'s plain glyph seat as its leading glyph, so a selected row draws no pill beside it (council round 11 B3)', () => {
    // A destination or Settings row's seat is a kit place seat, which the kit rule finds itself; a custom folder's row
    // keeps a plain 16px seat, which says so through the kit hook.
    const source = readFileSync('src/destination-shell.tsx', 'utf8')
    const plainSeat = source.slice(source.indexOf("props.place === undefined ? ("), source.indexOf('// The selected-place seat'))
    expect(plainSeat).toContain('data-section-icon=""')
    expect(plainSeat).toContain('{...LEADING_GLYPH_ATTRIBUTE}')
  })

  it('keeps the Settings column open on every Settings page: it is the one Settings navigation (council round 4 B1)', () => {
    setPhone(false)
    DestinationSelection.set('settings')
    const shell = renderShell({ activePanelId: 'dshfiles-settings', settingsNavigation: navigationOf(settingsState) })
    expect(shell.toggleSidebar).not.toHaveBeenCalled()
    expect(document.querySelector('[data-stage-folded]')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Settings pages' })).toBeTruthy()
  })

  it('lists Settings categories and pages in one list, each once, and the page drops its own list (council round 4 B1)', () => {
    setPhone(false)
    DestinationSelection.set('settings')
    const settingsPanels = [...panels, { id: 'ai-accounts', label: 'AI accounts', order: 1 }, { id: 'secret-catalog', label: 'Secrets', order: 2 }]
    const contributed = [
      { panelId: 'ai-accounts', destination: 'settings' as const, label: 'AI accounts', order: 0 },
      { panelId: 'secret-catalog', destination: 'settings' as const, label: 'Secrets', order: 1 },
    ]
    const navigation = navigationOf(settingsState)
    const shell = renderShell({ panels: settingsPanels, contributed, activePanelId: 'dshfiles-settings', settingsNavigation: navigation })
    const list = screen.getByRole('navigation', { name: 'Settings pages' })
    const labels = within(list)
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))
    expect(labels).toEqual(['General', 'Appearance', 'AI accounts', 'Plugins', 'Secrets'])
    expect(screen.queryByRole('button', { name: 'All settings' })).toBeNull()
    // General's first row names its group; the others keep a heading.
    expect(within(list).getByRole('group', { name: 'General' }).querySelector('h3')).toBeNull()
    expect(within(within(list).getByRole('group', { name: 'Models & accounts' })).getByText('Models & accounts')).toBeTruthy()
    // Round five B5, council round 6 B3: every category row has its 16px glyph in its group's tone; group heads are
    // 13/600 secondary, 16px under the group above and 4px over their first row.
    for (const [name, group] of [['General', 'general'], ['Appearance', 'general'], ['AI accounts', 'models']] as const) {
      const glyph = within(list).getByRole('button', { name }).querySelector('[data-section-icon] [data-settings-glyph]')
      expect(glyph?.getAttribute('class'), name).toContain('dshx:size-4')
      expect(glyph?.getAttribute('class'), name).toContain('dshx:text-(--settings-tone)')
      expect(glyph?.getAttribute('data-settings-glyph'), name).toBe(group)
    }
    // Round nine B2: each row's seat takes its group's tone, so the selected row's glyph sits on a 14% tile of it.
    const general = within(list).getByRole('button', { name: 'General' }).querySelector<HTMLElement>('[data-section-icon]')
    expect(general?.className).toContain('dshx:place-seat')
    expect(general?.style.getPropertyValue('--dshx-nav-tone')).toBe('var(--dshx-identity-7)')
    // Council round 8 B4: the Pages group's rows keep their own icons, in the Pages tone, never grey.
    const pages = list.querySelector<HTMLElement>('[data-settings-group="pages"]')
    expect(pages).not.toBeNull()
    for (const button of within(pages ?? list).getAllByRole('button'))
      expect(button.querySelector('[data-section-icon] [data-settings-glyph]')?.getAttribute('data-settings-glyph'), button.getAttribute('aria-label') ?? '').toBe('pages')
    const head = within(list).getByRole('group', { name: 'Models & accounts' }).querySelector('h3')
    expect(head?.className).toContain('dshx:text-sm')
    expect(head?.className).toContain('dshx:font-semibold')
    expect(head?.className).toContain('dshx:text-muted-foreground')
    expect(within(list).getByRole('group', { name: 'Models & accounts' }).className).toContain('dshx:mt-4')
    expect(head?.className).toContain('dshx:pb-1')
    // Council round 7 B2: the column keeps its "Settings" head on every Settings page (the page's h1 names the category),
    // so the list never jumps 36px between General and another Settings page.
    const columnTitle = screen.getByRole('heading', { level: 2, name: 'Settings' })
    expect(columnTitle.className).not.toContain('dshx:sr-only')
    expect(columnTitle.closest('header')?.className).not.toContain('dshx:sr-only')
    // The column sits on the nav surface (kit A4).
    expect(screen.getByRole('tabpanel', { name: 'Settings' }).className).toContain('dshx:surface-nav')
    // The page's current category is the column's current row.
    expect(within(list).getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    // The column draws the list while it shows: the Settings page drops its own.
    expect(navigation.attach).toHaveBeenCalledTimes(1)
    fireEvent.click(within(list).getByRole('button', { name: 'Appearance' }))
    expect(navigation.select).toHaveBeenCalledWith('plugin:dshfiles-ui-styles')
    // A category that stands for a page opens the page; one no category claims follows under Pages.
    fireEvent.click(within(list).getByRole('button', { name: 'AI accounts' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('ai-accounts')
    expect(within(within(list).getByRole('group', { name: 'Pages' })).getByRole('button', { name: 'Secrets' })).toBeTruthy()
    cleanup()
    expect(navigation.release).toHaveBeenCalledTimes(1)
  })

  it("keeps a page's own category one row under it while the page shows (council round 4 B1)", () => {
    setPhone(false)
    DestinationSelection.set('settings')
    const settingsPanels = [...panels, { id: 'ai-accounts', label: 'AI accounts', order: 1 }]
    const contributed = [{ panelId: 'ai-accounts', destination: 'settings' as const, label: 'AI accounts', order: 0 }]
    const navigation = navigationOf({ ...settingsState, open: false, activeId: undefined })
    renderShell({ panels: settingsPanels, contributed, activePanelId: 'ai-accounts', settingsNavigation: navigation })
    expect(screen.getByRole('button', { name: 'AI accounts' }).getAttribute('aria-current')).toBe('page')
    // Council round 6 B3: the child row starts 12px past its parent's text edge (10px inset + 16px glyph + 8px gap).
    expect(screen.getByRole('button', { name: 'AI accounts settings' }).className).toContain('dshx:pl-11.5')
    // On another Settings page the column keeps its visible title: the page's h1 names that page, not Settings.
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' }).className).not.toContain('dshx:sr-only')
    fireEvent.click(screen.getByRole('button', { name: 'AI accounts settings' }))
    expect(navigation.select).toHaveBeenCalledWith('ai-accounts')
  })

  it('shows match counts while Settings searches, and dims a category without one', () => {
    setPhone(false)
    DestinationSelection.set('settings')
    const searching = {
      ...settingsState,
      searching: true,
      activeId: undefined,
      groups: settingsState.groups.map(group => ({ ...group, items: group.items.map((item, index) => ({ ...item, count: index === 0 ? 3 : 0 })) })),
    }
    renderShell({ activePanelId: 'dshfiles-settings', settingsNavigation: navigationOf(searching) })
    expect(screen.getByRole('button', { name: 'General' }).textContent).toBe('General3')
    expect(screen.getByRole('button', { name: 'Appearance' }).className).toContain('dshx:opacity-45')
  })

  it('opens the folded list again from its own rail item, so a one-page destination stays one click away', () => {
    setPhone(false)
    DestinationSelection.set('inbox')
    const inboxPanels = [...panels, { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 }]
    const shell = props({ panels: inboxPanels, activePanelId: 'attention-inbox' })
    const view = render(
      <TooltipProvider>
        <DestinationShell {...shell} />
      </TooltipProvider>,
    )
    // Folded by the stage, not by hand.
    view.rerender(
      <TooltipProvider>
        <DestinationShell {...shell} collapsed />
      </TooltipProvider>,
    )
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-stage-folded]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Inbox' }))
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(2)
  })

  it('leaves a column the person collapsed or opened by hand as they left it', () => {
    setPhone(false)
    DestinationSelection.set('inbox')
    const inboxPanels = [...panels, { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 }]
    const collapsedByHand = renderShell({ panels: inboxPanels, collapsed: true, activePanelId: 'attention-inbox' })
    expect(collapsedByHand.toggleSidebar).not.toHaveBeenCalled()
    cleanup()
    localStorage.clear()
    DestinationSelection.set('inbox')
    const shell = props({ panels: inboxPanels, activePanelId: 'attention-inbox' })
    const view = render(
      <TooltipProvider>
        <DestinationShell {...shell} />
      </TooltipProvider>,
    )
    const draw = (overrides: Partial<DestinationShellProps>): void =>
      view.rerender(
        <TooltipProvider>
          <DestinationShell {...shell} {...overrides} />
        </TooltipProvider>,
      )
    draw({ collapsed: true })
    // Opened by hand while the Inbox shows: it stays open.
    draw({ collapsed: false })
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page')
  })

  it('folds the column while the page of a one-page destination is on stage (round five B2)', () => {
    setPhone(false)
    DestinationSelection.set('inbox')
    const inboxPanels = [...panels, { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 }]
    const shell = renderShell({ panels: inboxPanels, activePanelId: 'attention-inbox' })
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
    cleanup()
    localStorage.clear()
    // Observe lists several pages: its list stays.
    DestinationSelection.set('observe')
    const observe = renderShell({ activePanelId: 'dshfiles-usage' })
    expect(observe.toggleSidebar).not.toHaveBeenCalled()
  })

  it('lists the Settings pages without a layout switch: one sidebar layout (b:952m)', () => {
    setPhone(false)
    const shell = renderShell()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }))
    expect(shell.openSettings).toHaveBeenCalled()
    expect(screen.queryByRole('radio', { name: 'Free docking' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull()
  })

  it('folded, keeps the rail it has open: its labels, order, width and active item (round five B1)', () => {
    setPhone(false)
    DestinationSelection.set('observe')
    type RailSnapshot = { readonly labels: string; readonly width: string; readonly active: string | null }
    const rail = (): RailSnapshot => {
      const nav = document.querySelector('nav[aria-label="Destinations"]')
      const items = [...(nav?.querySelectorAll('[role="tab"]') ?? [])]
      return {
        labels: items.map(item => item.textContent).join('|'),
        width: nav?.className ?? '',
        active: items.find(item => item.getAttribute('aria-selected') === 'true')?.getAttribute('data-destination') ?? null,
      }
    }
    renderShell({ collapsed: false, activePanelId: 'dshfiles-usage' })
    const open = rail()
    // The rail paints the panel step itself, so it reads the same beside the list and on the frame's folded track.
    expect(open.width).toContain('dshx:bg-[var(--dsw-specific-sidebar-fill)]')
    expect(open.labels).toContain('Knowledge')
    expect(open.active).toBe('observe')
    cleanup()
    renderShell({ collapsed: true, activePanelId: 'dshfiles-usage' })
    expect(rail()).toEqual(open)
    expect(screen.queryByText('Thread list')).toBeNull()
  })

  it('collapsed, keeps only the rail and expands on a destination', () => {
    setPhone(false)
    const shell = renderShell({ collapsed: true })
    expect(screen.queryByText('Thread list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(shell.startSession).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Land' }))
    expect(shell.toggleSidebar).toHaveBeenCalled()
  })

  it('opens the Inbox page at once, with its count at the trailing edge of its one row', () => {
    setPhone(false)
    const inboxPanels = [
      ...panels,
      { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 },
      { id: 'thread-sidebar-waiting', label: 'Waiting threads', order: 3 },
    ]
    const contributed = [{ panelId: 'thread-sidebar-waiting', destination: 'inbox' as const, label: 'Waiting threads', order: 2, unlisted: true }]
    const shell = renderShell({
      panels: inboxPanels,
      contributed,
      // The Inbox glyph as its plugin draws it: a count over the icon.
      renderPanelIcon: panelId =>
        panelId === 'attention-inbox' ? (
          <span data-attention-badge="2">
            <svg />
            <span>2</span>
          </span>
        ) : null,
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Inbox' }))
    // One page, so the rail opens it: no second row that lists the same threads.
    expect(shell.selectPanel).toHaveBeenCalledWith('attention-inbox')
    const rows = within(screen.getByRole('navigation', { name: 'Inbox pages' })).getAllByRole('button')
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Inbox'])
    // SAFETY: the assertion above pins exactly one row, so the first one exists.
    const row = rows[0] as HTMLElement
    const seat = row.querySelector('[data-attention-badge]')?.parentElement
    // The count is positioned against the row (its trailing edge), not over the 16px icon where it touched the label.
    expect(row.className).toContain('dshx:relative')
    expect(seat?.className).toContain('dshx:[&_[data-attention-badge]]:static')
    expect(seat?.className).toContain('dshx:[&_[data-attention-badge]>span]:right-8')
  })

  it('says the Inbox did not load, with Reload and Open Plugins, when its page never registered', () => {
    setPhone(false)
    const shell = renderShell()
    fireEvent.click(screen.getByRole('tab', { name: 'Inbox' }))
    expect(screen.getByText('Inbox did not load. Reload the page; if it keeps failing, open Settings › Plugins.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Open Plugins' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('plugins')
  })

  it('on a phone, the Inbox tab opens the Inbox page directly', () => {
    setPhone(true)
    const inboxPanels = [
      ...panels,
      { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 },
      { id: 'thread-sidebar-waiting', label: 'Waiting threads', order: 3 },
    ]
    const contributed = [{ panelId: 'thread-sidebar-waiting', destination: 'inbox' as const, label: 'Waiting threads', order: 2, unlisted: true }]
    const shell = renderShell({ panels: inboxPanels, contributed, collapsed: true })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', { name: 'Inbox' }))
    // No intermediate two-row list (Needs you, Waiting threads) between the tab and the page.
    expect(shell.selectPanel).toHaveBeenCalledWith('attention-inbox')
    expect(screen.queryByRole('button', { name: 'Waiting threads' })).toBeNull()
  })

  it("on a phone, ends the full-screen list above the frame's status pill row while the frame draws it", () => {
    setPhone(true)
    renderShell({ collapsed: false })
    const list = document.querySelector<HTMLElement>('[data-phone-list]')
    expect(list?.className).toContain('dshx:[html:not([data-phone-keyboard]):has([data-status-strip=compact])_&]:[--phone-list-status-room:44px]')
    expect(list?.style.bottom).toContain('var(--phone-list-status-room, 0px)')
  })

  it('replaces the rail with a bottom tab bar on a phone', () => {
    setPhone(true)
    const shell = renderShell({ collapsed: true })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.documentElement.hasAttribute('data-shell-phone-nav')).toBe(true)
    const bar = screen.getByRole('navigation', { name: 'Destinations' })
    expect(
      within(bar)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Threads', 'Inbox', 'Land', 'More'])
    // No New tab: New thread is the `+` in the Threads list header (E8), absent while the list is closed.
    expect(screen.queryByRole('button', { name: 'New thread' })).toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: 'Inbox' }))
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(shell.record).toHaveBeenCalledWith({ destination: 'inbox', surface: 'tab-bar' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Land' }))
    expect(shell.record).toHaveBeenCalledWith(expect.objectContaining({ destination: 'land', surface: 'tab-bar' }))
    cleanup()
    expect(document.documentElement.hasAttribute('data-shell-phone-nav')).toBe(false)
  })

  it('on a phone, lights the current tab with its tone tile and a 600 label, and More while Settings shows (council round 3 B6)', () => {
    setPhone(true)
    renderShell({ collapsed: true, activePanelId: 'dshfiles-settings' })
    const bar = screen.getByRole('navigation', { name: 'Destinations' })
    const more = within(bar).getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-current')).toBe('page')
    expect(more.className).toContain('dshx:nav-tone-settings')
    expect(more.querySelector('[data-phone-tab-seat]')?.className).toContain(PHONE_TAB_PILL)
    expect(within(more).getByText('More').className).toContain('dshx:font-semibold')
    const threads = within(bar).getByRole('button', { name: 'Threads' })
    expect(threads.getAttribute('aria-current')).toBeNull()
    expect(threads.querySelector('[data-phone-tab-seat]')?.className).not.toContain('dshx:bg-nav-tile')
    // Colour on the current tab only (council round 12 B3, reversing round nine B3): a tinted glyph means "selected" on a
    // phone, so the others rest in tertiary ink; the current glyph takes its tone on its tile.
    for (const tab of within(bar).getAllByRole('button')) {
      const seat = tab.querySelector('[data-phone-tab-seat]')?.className
      if (tab === more) expect(seat).toContain('dshx:text-foreground')
      else {
        expect(seat).not.toContain('dshx:text-nav-tone')
        expect(seat).toContain('dshx:text-(--dsw-alias-label-tertiary)')
      }
    }
    expect(threads.className).toContain('dshx:nav-tone-threads')
    cleanup()
    // One neutral selected pill on every current tab (council round 13 B2): the tone's own tile read blue on Threads and
    // grey on Inbox. The glyph carries the tone; Inbox and More, the neutral destinations, draw ink.
    const inboxPanels = [...panels, { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 }]
    for (const destination of ['threads', 'inbox', 'more'] as const) {
      localStorage.clear()
      if (destination === 'inbox') DestinationSelection.set('inbox')
      if (destination === 'more') renderShell({ collapsed: true, activePanelId: 'dshfiles-settings' })
      else renderShell({ panels: inboxPanels, collapsed: false })
      const tab = within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', { name: { threads: 'Threads', inbox: 'Inbox', more: 'More' }[destination] })
      expect(tab.getAttribute('aria-current'), destination).toBe('page')
      const seat = tab.querySelector('[data-phone-tab-seat]')?.className ?? ''
      expect(seat, destination).toContain(PHONE_TAB_PILL)
      expect(seat, destination).not.toContain('dshx:bg-nav-tile')
      expect(seat, destination).toContain(destination === 'threads' ? 'dshx:text-nav-tone' : 'dshx:text-foreground')
      cleanup()
    }
    // Another destination's page reached through More keeps More lit too.
    renderShell({ collapsed: true, activePanelId: 'dshfiles-usage' })
    expect(within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('page')
  })

  it('on a phone, puts the status button in the Threads bar\'s leading seat, New thread trailing, and none without frame-layout (council round 3 B6, round 6 B1)', () => {
    setPhone(true)
    renderShell({ collapsed: false })
    expect(document.querySelector('[data-phone-status-probe]')).toBeNull()
    cleanup()
    phoneStatus.Button = () => <button type="button" aria-label="Status" data-phone-status-probe="" />
    try {
      renderShell({ collapsed: false })
      const bar = document.querySelector<HTMLElement>('[data-phone-top-bar]')
      const status = bar?.querySelector('[data-phone-status-probe]')
      const add = bar?.querySelector('[data-phone-new]')
      expect(status).not.toBeNull()
      if (status == null || add == null) throw new Error('Phone status button or + button missing')
      expect(status.compareDocumentPosition(add)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      // The same seat as the Inbox bar's gauge: before the centred title, with + alone after it.
      const title = bar?.querySelector('[data-phone-title]')
      if (title == null) throw new Error('Phone title missing')
      expect(status.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(title.compareDocumentPosition(add)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    } finally {
      phoneStatus.Button = undefined
    }
  })

  it('gives the phone thread list a 44px search, the touch control height (council round 6 B8)', () => {
    setPhone(true)
    renderShell({ collapsed: false })
    const search = within(document.querySelector<HTMLElement>('[data-phone-list]') ?? document.body).getByRole('button', { name: 'Search threads' })
    // The kit's one control height (round nine B5, kit A4): 32px, 44px under a coarse pointer.
    expect(search.getAttribute('data-size')).toBe('field')
    expect(search.className).toContain('dshx:h-(--dshx-control-h)')
    // It looks like a field, with the field edge (council round 7 B3).
    expect(search.className).toContain('dshx:border-field-border')
    cleanup()
    // The desktop column's search is 32px, the height of the project and Filter fields beside it (round nine B5).
    setPhone(false)
    renderShell({ collapsed: false })
    expect(screen.getByRole('button', { name: 'Search threads' }).className).toContain('dshx:h-(--dshx-control-h)')
    expect(screen.getByRole('button', { name: 'Search threads' }).className).not.toContain('dshx:h-7')
    expect(screen.getByRole('button', { name: 'Search threads' }).className).toContain('dshx:border-field-border')
    // It stands for a text field (council round 10 A1): the text field's edge and paper at rest, not the quiet chip's
    // transparent edge and fill that the project and Filter triggers beside it take.
    for (const phone of [false, true]) {
      cleanup()
      setPhone(phone)
      renderShell({ collapsed: false })
      const launcher = screen.getByRole('button', { name: 'Search threads' }).className
      expect(launcher).toContain('dshx:bg-background')
      expect(launcher).not.toContain('dshx:bg-trigger-fill')
      expect(launcher).not.toContain('dshx:border-transparent')
    }
  })

  it('draws Search threads in the kit field look, left-aligned, with no outline edge to replace the field edge in dark (council round 8 B1)', () => {
    for (const phone of [false, true]) {
      setPhone(phone)
      renderShell({ collapsed: false })
      const search = screen.getByRole('button', { name: 'Search threads' })
      expect(search.getAttribute('data-variant')).toBe('field')
      // The outline variant's `dark:border-input` beat the field edge in dark: 1.43:1 rendered (#393633 on #1e1b19).
      expect(search.className).not.toContain('dshx:dark:border-input')
      expect(search.className).not.toContain('dshx:dark:bg-input/30')
      expect(search.className).toContain('dshx:justify-start')
      expect(search.className).not.toContain('dshx:justify-between')
      cleanup()
    }
  })

  it('ends the phone search row in the list\'s scope seat, one 44px toolbar row, and publishes it (council round 10 B1)', () => {
    setPhone(true)
    renderShell({ collapsed: false })
    const list = document.querySelector<HTMLElement>('[data-phone-list]')
    const search = within(list ?? document.body).getByRole('button', { name: 'Search threads' })
    const seat = search.parentElement?.querySelector<HTMLElement>('[data-thread-list-scope]')
    if (seat == null) throw new Error('Phone scope seat missing')
    // After the search, in the same row, 8px apart; the row stands 6px over the first group head.
    expect(search.compareDocumentPosition(seat)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(search.parentElement?.className).toContain('dshx:gap-2')
    expect(search.parentElement?.className).toContain('dshx:pb-1.5')
    expect(ListHeaderExtras.get().scopeSlot).toBe(seat)
    // The toolbar band measures 48px (council round 11 B2): the list starts 4px under the top bar's rule when it leads
    // with this row, instead of the 12px other lists keep.
    expect(search.parentElement?.hasAttribute('data-threads-toolbar')).toBe(true)
    expect(list?.className).toContain('dshx:has-[[data-threads-toolbar]]:pt-1')
    cleanup()
    // A desktop column keeps the list's own project and Filter row: no seat.
    setPhone(false)
    renderShell({ collapsed: false })
    expect(document.querySelector('[data-thread-list-scope]')).toBeNull()
    expect(ListHeaderExtras.get().scopeSlot).toBeNull()
  })

  it('reclaims the search\'s extra 16px from the gaps around the filter row and the group heads on touch (council round 6 B8)', () => {
    const source = readFileSync('src/client.tsx', 'utf8')
    // The project and Filter row sits 4px under the search and directly over the first group head on touch; the phone
    // shell grid (round nine B4) puts it on the 12px gutter, 6px over the first head.
    expect(source).toContain("scopeSlot === null ? 'dshx:px-2 dshx:py-1 dshx:pointer-coarse:py-0 dshx:phone:px-3 dshx:phone:pb-1.5'")
    // Groups stand flush on touch: the 2px each group added above its head is gone.
    expect(source).toContain('dshx:pointer-coarse:not-first:mt-0 dshx:pointer-coarse:first:mt-0')
    expect(source).not.toContain('dshx:pointer-coarse:not-first:mt-0.5')
  })

  it('puts the phone Threads list on one gutter: fills from 12px, text from 24px, 12px under the top bar (round nine B4, B5)', () => {
    setPhone(true)
    renderShell({ collapsed: false })
    const list = document.querySelector<HTMLElement>('[data-phone-list]')
    expect(list?.className).toContain('dshx:pt-3')
    expect(list?.className).not.toMatch(/(^| )dshx:pt-1( |$)/u)
    const search = within(list ?? document.body).getByRole('button', { name: 'Search threads' })
    expect(search.parentElement?.className).toContain('dshx:px-3')
    expect(search.className).toContain('dshx:px-3')
    const source = readFileSync('src/client.tsx', 'utf8')
    // The project and Filter fields are 44px on a phone like the search, 32px beside it on a desktop.
    expect(source).toContain('triggerClassName="dshx:min-w-0 dshx:flex-1 dshx:px-2.5 dshx:phone:px-3"')
    expect(source).toContain('size="field"\n          data-thread-list-filter=""')
    expect(source).toContain("'dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3'")
    expect(source).not.toContain('dshx:px-2.5 dshx:pointer-coarse:h-7"')
    // Rows and the scroll area sit on the same gutter, the group heads' labels on the 24px text edge.
    expect(source).toContain('dshx:px-2 dshx:pb-6 dshx:pointer-coarse:pb-3.5 dshx:phone:px-3')
    expect(source).toContain("'dshx:phone:pl-3',")
    expect(readFileSync('src/thread-group-header.tsx', 'utf8')).toContain('dshx:pointer-coarse:h-7 dshx:phone:px-3')
  })

  it('keeps the phone shell on a phone turned sideways (844x390, coarse pointer)', () => {
    // Only the landscape clause of the phone rule matches: the viewport is 844px wide.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query.split(',').some(part => part.trim() === '(pointer: coarse) and (max-height: 500px)'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    renderShell({ collapsed: true })
    expect(document.documentElement.hasAttribute('data-shell-phone-nav')).toBe(true)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Destinations' })).toBeTruthy()
    cleanup()
  })

  it('on a phone, starts a thread from the + in the Threads list header and lists Land outside More', () => {
    setPhone(true)
    const shell = renderShell({ collapsed: false })
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(shell.startSession).toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', { name: 'More' }))
    const more = screen.getByRole('navigation', { name: 'More destinations' })
    expect(more.querySelector('[data-destination=land]')).toBeNull()
    expect(more.querySelector('[data-destination=work]')).not.toBeNull()
    cleanup()
    expect(document.documentElement.hasAttribute('data-shell-phone-nav')).toBe(false)
  })

  it('on a phone, closes the full-screen list when a thread opens', () => {
    setPhone(true)
    const shell = props({ collapsed: false })
    const view = render(
      <TooltipProvider>
        <DestinationShell {...shell} />
      </TooltipProvider>,
    )
    expect(screen.getByText('Thread list')).toBeTruthy()
    view.rerender(
      <TooltipProvider>
        <DestinationShell {...shell} selectedThreadId="session-1" />
      </TooltipProvider>,
    )
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('on a phone, keeps the list open when Back keeps a typed draft as a thread (one Back, not two)', () => {
    setPhone(true)
    // A blank draft Session is on the stage (no Host thread yet); Back has just opened the list.
    const shell = props({ collapsed: false, selectedThreadId: null, stageThreadId: null, stageSessionId: 'session-draft' })
    const view = render(
      <TooltipProvider>
        <DestinationShell {...shell} />
      </TooltipProvider>,
    )
    // The typed draft is kept as a Session and the list selection catches up with it: not a pick.
    view.rerender(
      <TooltipProvider>
        <DestinationShell {...shell} selectedThreadId="session-draft" />
      </TooltipProvider>,
    )
    expect(shell.toggleSidebar).not.toHaveBeenCalled()
    // Picking another thread still closes the list.
    view.rerender(
      <TooltipProvider>
        <DestinationShell {...shell} selectedThreadId="session-other" stageSessionId="session-other" />
      </TooltipProvider>,
    )
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('on a phone, names a thread picked in the list before the stage opens it', () => {
    setPhone(true)
    // The stage still shows a blank draft: without the pick the bar says New thread.
    renderShell({ collapsed: true, selectedThreadId: null, stageThreadId: null, stageSessionId: 'session-draft', pendingTitle: 'Fix the login race' })
    expect(document.querySelector('[data-phone-title]')?.textContent).toBe('Fix the login race')
    expect(document.querySelector('header[data-phone-top-bar]')?.getAttribute('data-phone-stage')).toBe('thread')
  })

  it('on a phone, centres a page title apart from a muted 17px Back, and starts a thread title 12px after the chevron (council round 4 B3)', () => {
    setPhone(true)
    renderShell({ collapsed: true, activePanelId: 'dshfiles-settings' })
    expect(document.querySelector('[data-phone-bar-layout]')?.getAttribute('data-phone-bar-layout')).toBe('centred')
    const title = document.querySelector('[data-phone-title]')
    expect(title?.className).toContain('dshx:text-center')
    expect(title?.className).toContain('dshx:font-semibold')
    const back = screen.getByRole('button', { name: 'Back to More' })
    expect(back.textContent).toBe('More')
    expect(back.className).toContain('dshx:text-muted-foreground')
    // Both read at 17px, set once on the bar row they share.
    expect(document.querySelector('[data-phone-bar-layout]')?.className).toContain('dshx:text-[17px]')
    // The way back and the title are two cells of the bar, not one run of text.
    expect(back.contains(title)).toBe(false)
    cleanup()
    renderShell({ collapsed: true, selectedThreadId: 'session-1', stageThreadId: 'session-1', stageTitle: 'Fix the login race' })
    expect(document.querySelector('[data-phone-bar-layout]')?.getAttribute('data-phone-bar-layout')).toBe('leading')
    const chevron = screen.getByRole('button', { name: 'Back to Threads' })
    // 28px wide (the title starts 12px after the glyph), with a 44px touch area.
    expect(chevron.className).toContain('dshx:w-7')
    expect(chevron.className).toContain('dshx:after:w-11')
  })

  it('on a phone, titles a thread 17/600 over a 13px muted line with its status glyph and subagents (council round 7 B5)', () => {
    setPhone(true)
    renderShell({
      collapsed: true,
      selectedThreadId: 'session-1',
      stageThreadId: 'session-1',
      stageTitle: 'Fix invoice tax rounding',
      stageSubtitle: { working: true, label: '1 subagent' },
    })
    const title = document.querySelector('[data-phone-title]')
    expect(title?.textContent).toBe('Fix invoice tax rounding')
    // 17px from the bar row it sits in, at 600.
    expect(document.querySelector('[data-phone-bar-layout]')?.className).toContain('dshx:text-[17px]')
    expect(title?.className).toContain('dshx:font-semibold')
    expect(title?.className).not.toContain('dshx:font-bold')
    expect(title?.className).not.toMatch(/dshx:text-(xl|lg|title|\[20px\])/u)
    const subtitle = document.querySelector('[data-phone-subtitle]')
    expect(subtitle?.textContent).toContain('1 subagent')
    // 13px: the kit's text-sm.
    expect(subtitle?.className).toContain('dshx:text-sm')
    expect(subtitle?.className).toContain('dshx:text-muted-foreground')
    expect(subtitle?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('working')
    // Title and subtitle stack in one cell after the chevron.
    expect(title?.parentElement?.contains(subtitle ?? null)).toBe(true)
    cleanup()
    // A page keeps its one centred line.
    renderShell({ collapsed: true, activePanelId: 'dshfiles-settings', stageSubtitle: { working: true, label: '1 subagent' } })
    expect(document.querySelector('[data-phone-subtitle]')).toBeNull()
  })
})

describe('phone navigation: drawer', () => {
  /**
   * jsdom has no Touch constructor: a touch event carries plain touch points, which is all the gesture reads. Each event
   * lands 100ms after the previous one, so the release velocity is the last step's travel per 100ms.
   */
  let clock = 0
  const touch = (target: Element, type: string, x: number, y = 300): void => {
    const event = new Event(type, { bubbles: true })
    clock += 100
    Object.defineProperty(event, 'timeStamp', { value: clock })
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }] })
    Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 1, clientX: x, clientY: y }] })
    act(() => {
      target.dispatchEvent(event)
    })
  }
  const drag = (target: Element, xs: readonly number[]): void => {
    const [first, ...rest] = xs
    if (first === undefined) return
    touch(target, 'touchstart', first)
    for (const x of rest) touch(target, 'touchmove', x)
    touch(target, 'touchend', xs.at(-1) ?? first)
  }
  const shell = (shellProps: DestinationShellProps): JSX.Element => (
    <TooltipProvider>
      <DestinationShell {...shellProps} />
    </TooltipProvider>
  )
  const threadProps = (): DestinationShellProps =>
    props({ collapsed: true, selectedThreadId: 'session-1', stageThreadId: 'session-1', stageTitle: 'Fix the login race' })

  const drawerState = (): string | null | undefined => document.querySelector('[data-phone-drawer]')?.getAttribute('data-phone-drawer')
  const showThreads = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Show threads' }))
  }

  it('switches the stack for a drawer: a sidebar button instead of Back, and no tab bar', () => {
    setPhone(true)
    const inThread = threadProps()
    const view = render(shell(inThread))
    expect(screen.getByRole('button', { name: 'Back to Threads' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show threads' })).toBeNull()
    view.rerender(shell({ ...inThread, phoneNavigation: 'drawer' }))
    expect(screen.queryByRole('button', { name: 'Back to Threads' })).toBeNull()
    expect(document.querySelector('[data-phone-tab-bar]')).toBeNull()
    expect(document.querySelector('[data-phone-title]')?.textContent).toBe('Fix the login race')
    const button = screen.getByRole('button', { name: 'Show threads' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // Closed, the drawer is laid out but hidden from pointer and assistive tech.
    expect(document.querySelector<HTMLElement>('[data-phone-drawer]')?.style.visibility).toBe('hidden')
    showThreads()
    expect(drawerState()).toBe('open')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // The drawer is the shell's own state: the frame's column never flips, so the frame and sidebar do not re-render.
    expect(inThread.toggleSidebar).not.toHaveBeenCalled()
    // Back to the stack: the Back button and the stack's behaviour return.
    view.rerender(shell({ ...inThread, phoneNavigation: 'stack' }))
    expect(screen.getByRole('button', { name: 'Back to Threads' })).toBeTruthy()
    expect(document.querySelector('[data-phone-drawer]')).toBeNull()
  })

  it('opens over the thread with New thread and every destination, and closes on the scrim, Escape and a pick', () => {
    setPhone(true)
    const closed = { ...threadProps(), phoneNavigation: 'drawer' as const }
    const view = render(shell(closed))
    showThreads()
    const drawer = screen.getByRole('dialog', { name: 'Threads' })
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(within(drawer).getByText('Thread list')).toBeTruthy()
    // The thread stays on the stage: the top bar still names it.
    expect(document.querySelector('header[data-phone-top-bar]')?.getAttribute('data-phone-stage')).toBe('thread')
    fireEvent.click(within(drawer).getByRole('button', { name: 'New thread' }))
    expect(closed.startSession).toHaveBeenCalled()
    expect(drawerState()).toBe('closed')
    showThreads()
    const destinations = within(screen.getByRole('dialog', { name: 'Threads' })).getByRole('navigation', { name: 'Destinations' })
    expect(
      within(destinations)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Inbox', 'Land', 'More'])
    // More lists the rest inside the drawer, with Back to Threads.
    fireEvent.click(within(destinations).getByRole('button', { name: 'More' }))
    expect(screen.getByRole('navigation', { name: 'More destinations' }).querySelector('[data-destination=work]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Threads' }))
    expect(screen.getByRole('button', { name: 'New thread' })).toBeTruthy()
    const scrim = document.querySelector('[data-phone-drawer-scrim]')
    if (scrim === null) throw new Error('the drawer renders its scrim')
    fireEvent.click(scrim)
    expect(drawerState()).toBe('closed')
    showThreads()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawerState()).toBe('closed')
    // Picking another thread closes it at once, without the stack's page transition.
    showThreads()
    view.rerender(shell({ ...closed, selectedThreadId: 'session-2', stageThreadId: 'session-2', stageSessionId: 'session-2' }))
    expect(drawerState()).toBe('closed')
    // A frame reveal (a palette "Go to…") expands the column: the drawer opens and the column folds back.
    view.rerender(shell({ ...closed, collapsed: false, selectedThreadId: 'session-2', stageThreadId: 'session-2', stageSessionId: 'session-2' }))
    expect(drawerState()).toBe('open')
    expect(closed.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('returns a thread opened from the Inbox page to the Inbox, keeping the sidebar button', () => {
    setPhone(true)
    const onInbox = props({
      panels: [...panels, { id: 'attention-inbox', label: 'Inbox', order: 1 }],
      collapsed: true,
      activePanelId: 'attention-inbox',
      phoneNavigation: 'drawer',
    })
    const view = render(shell(onInbox))
    expect(screen.queryByRole('button', { name: 'Back to Inbox' })).toBeNull()
    // An Inbox item's Open puts its thread on the stage in place of the page.
    view.rerender(shell({ ...onInbox, activePanelId: null, selectedThreadId: 'session-1', stageThreadId: 'session-1', stageTitle: 'Answer me' }))
    const back = screen.getByRole('button', { name: 'Back to Inbox' })
    const sidebar = screen.getByRole('button', { name: 'Show threads' })
    expect(back.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('[data-phone-title]')?.textContent).toBe('Answer me')
    showThreads()
    expect(drawerState()).toBe('open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawerState()).toBe('closed')
    fireEvent.click(back)
    expect(onInbox.selectPanel).toHaveBeenCalledWith('attention-inbox')
    view.rerender(shell({ ...onInbox, selectedThreadId: 'session-1', stageThreadId: 'session-1' }))
    expect(screen.queryByRole('button', { name: 'Back to Inbox' })).toBeNull()
    // A thread picked from the drawer list has no page to return to.
    showThreads()
    view.rerender(shell({ ...onInbox, activePanelId: null, selectedThreadId: 'session-2', stageThreadId: 'session-2' }))
    expect(drawerState()).toBe('closed')
    expect(screen.queryByRole('button', { name: 'Back to Inbox' })).toBeNull()
  })

  it('follows a swipe from the left edge and snaps open past half way, closed short of it', () => {
    setPhone(true)
    render(shell({ ...threadProps(), phoneNavigation: 'drawer' }))
    const stage = document.body
    // A short drag snaps back closed and leaves the drawer hidden again.
    drag(stage, [4, 30, 60, 90])
    expect(drawerState()).toBe('closed')
    const panel = document.querySelector<HTMLElement>('[data-phone-drawer]')
    expect(panel?.style.transform).toBe('translateX(-100%)')
    // Mid-drag the drawer follows the finger.
    touch(stage, 'touchstart', 4)
    touch(stage, 'touchmove', 40)
    touch(stage, 'touchmove', 184)
    expect(panel?.hasAttribute('data-phone-drawer-dragging')).toBe(true)
    expect(panel?.style.transform).toBe('translateX(-50.00%)')
    touch(stage, 'touchmove', 260)
    touch(stage, 'touchend', 260)
    expect(drawerState()).toBe('open')
    expect(panel?.hasAttribute('data-phone-drawer-dragging')).toBe(false)
    // Open, a leftward swipe on the drawer closes it.
    drag(screen.getByRole('dialog', { name: 'Threads' }), [300, 270, 200, 100])
    expect(drawerState()).toBe('closed')
  })

  it('opens from a rightward drag mid-stage, where Android gesture navigation leaves the page its touches', () => {
    setPhone(true)
    render(shell({ ...threadProps(), phoneNavigation: 'drawer' }))
    const stage = document.createElement('main')
    stage.innerHTML =
      '<p data-testid="text">Answer</p><pre data-testid="code" style="overflow-x:auto">wide</pre><textarea data-testid="field"></textarea><div data-composer-card=""><button data-testid="chip">Model</button></div>'
    document.body.append(stage)
    const at = (id: string): Element => stage.querySelector(`[data-testid="${id}"]`) ?? document.body
    const code = at('code')
    Object.defineProperty(code, 'scrollWidth', { value: 800 })
    Object.defineProperty(code, 'clientWidth', { value: 390 })
    // Mid-drag from x=120 the drawer (360px in jsdom's 1024px window) follows the finger, then opens past half way.
    touch(at('text'), 'touchstart', 120)
    touch(at('text'), 'touchmove', 150)
    touch(at('text'), 'touchmove', 300)
    const panel = document.querySelector<HTMLElement>('[data-phone-drawer]')
    expect(panel?.hasAttribute('data-phone-drawer-dragging')).toBe(true)
    expect(panel?.style.transform).toBe('translateX(-50.00%)')
    touch(at('text'), 'touchmove', 400)
    touch(at('text'), 'touchend', 400)
    expect(drawerState()).toBe('open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawerState()).toBe('closed')
    // Mostly vertical travel scrolls the transcript.
    touch(at('text'), 'touchstart', 120, 500)
    touch(at('text'), 'touchmove', 140, 400)
    touch(at('text'), 'touchmove', 330, 380)
    touch(at('text'), 'touchend', 330, 380)
    expect(drawerState()).toBe('closed')
    // A horizontal scroller, a field and the composer keep their own sideways drags.
    for (const id of ['code', 'field', 'chip']) {
      drag(at(id), [120, 160, 300, 400])
      expect(drawerState()).toBe('closed')
    }
    // So does a text selection.
    const range = document.createRange()
    range.selectNodeContents(at('text'))
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    drag(at('text'), [120, 160, 300, 400])
    expect(drawerState()).toBe('closed')
    document.getSelection()?.removeAllRanges()
    drag(at('text'), [120, 160, 300, 400])
    expect(drawerState()).toBe('open')
    stage.remove()
  })
})

describe('DSH actions on the rail (b:kgcc)', () => {
  const actions = (overrides: { copied?: boolean; pending?: boolean } = {}): DestinationShellProps['railActions'] => [
    {
      id: 'restart',
      label: overrides.pending === true ? 'Restart DSH to apply updates (2 plugins)' : 'Restart DSH',
      icon: <svg data-icon="restart" />,
      tone: overrides.pending === true ? 'warning' : 'muted',
      pulse: overrides.pending === true,
      onSelect: vi.fn(),
    },
    {
      id: 'copy-url',
      label: 'Copy DSH URL for agents',
      icon: <svg data-icon="link" />,
      feedback: overrides.copied === true ? 'Copied' : null,
      feedbackIcon: <svg data-icon="check" />,
      onSelect: vi.fn(),
    },
    { id: 'pair-phone', label: 'Pair a phone', icon: <svg data-icon="qr" />, onSelect: vi.fn() },
  ]

  /** Every rail control in document order, by accessible name. */
  const railOrder = (): string[] =>
    [...screen.getByRole('tablist', { name: 'Destinations' }).querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? '')

  it('puts the group directly above Settings, below the folders, and runs each action', () => {
    setPhone(false)
    const railActions = actions()
    renderShell({ railActions })
    expect(railOrder().slice(-4)).toEqual(['Restart DSH', 'Copy DSH URL for agents', 'Pair a phone', 'Settings'])
    const group = screen.getByRole('group', { name: 'DSH actions' })
    fireEvent.click(within(group).getByRole('button', { name: 'Restart DSH' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Copy DSH URL for agents' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Pair a phone' }))
    for (const action of railActions ?? []) expect(action.onSelect).toHaveBeenCalledTimes(1)
    // Muted, never coloured, while nothing waits.
    expect(within(group).getByRole('button', { name: 'Restart DSH' }).className).toContain('dshx:text-muted-foreground')
  })

  it('keeps the same group in the same place on the collapsed rail', () => {
    setPhone(false)
    renderShell({ collapsed: true, railActions: actions() })
    expect(railOrder().slice(-4)).toEqual(['Restart DSH', 'Copy DSH URL for agents', 'Pair a phone', 'Settings'])
  })

  it('draws nothing without an action', () => {
    setPhone(false)
    renderShell({ railActions: [] })
    expect(screen.queryByRole('group', { name: 'DSH actions' })).toBeNull()
  })

  it('marks a pending restart in amber with a pulse, and shows Copied after a copy', () => {
    setPhone(false)
    renderShell({ railActions: actions({ pending: true, copied: true }) })
    const restart = screen.getByRole('button', { name: 'Restart DSH to apply updates (2 plugins)' })
    expect(restart.className).toContain('dshx:text-warning')
    expect(restart.className).toContain('dshx:animate-pulse')
    const copy = screen.getByRole('button', { name: 'Copy DSH URL for agents' })
    expect(copy.className).not.toContain('dshx:text-warning')
    expect(copy.querySelector('[data-icon=check]')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Copied')
  })

  it('shows a pending page reload in amber that opens its plugin list', () => {
    setPhone(false)
    const onOpenChange = vi.fn()
    const reload = (open: boolean): NonNullable<DestinationShellProps['railActions']>[number] => ({
      id: 'reload',
      label: 'Restart the page to apply updates (1 plugin)',
      icon: <svg data-icon="reload" />,
      tone: 'warning',
      popover: { label: 'Restart the page to apply updates', content: <p>@dshfiles/whiteboard</p>, open, onOpenChange },
    })
    const view = render(
      <TooltipProvider>
        <DestinationShell {...props({ railActions: [reload(false)] })} />
      </TooltipProvider>,
    )
    const button = screen.getByRole('button', { name: 'Restart the page to apply updates (1 plugin)' })
    expect(button.className).toContain('dshx:text-warning')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    view.rerender(
      <TooltipProvider>
        <DestinationShell {...props({ railActions: [reload(true)] })} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('dialog', { name: 'Restart the page to apply updates' }).textContent).toContain('@dshfiles/whiteboard')
  })

  it('lists the same actions under More › DSH on a phone, after the destinations', () => {
    setPhone(true)
    const railActions = actions()
    renderShell({ collapsed: false, railActions })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', { name: 'More' }))
    const more = screen.getByRole('navigation', { name: 'More destinations' })
    const section = within(more).getByRole('region', { name: 'DSH' })
    expect(more.lastElementChild).toBe(section)
    const rows = within(section).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual(['Restart DSH', 'Copy DSH URL for agents', 'Pair a phone'])
    // 44pt targets whatever the pointer reports.
    for (const row of rows) expect(row.className).toContain('dshx:[&_button]:min-h-11')
    fireEvent.click(within(section).getByRole('button', { name: 'Pair a phone' }))
    expect(railActions?.[2]?.onSelect).toHaveBeenCalledTimes(1)
    cleanup()
  })
})

describe('MovedToDialog', () => {
  it('opens a moved page from the moved-to list', () => {
    const openEntry = vi.fn()
    render(<MovedToDialog panels={panels} openEntry={openEntry} />)
    act(() => MovedTo.open())
    expect(screen.getByRole('heading', { name: 'Where did a page go?' })).toBeTruthy()
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open Usage in Observe › Usage' }))
    expect(openEntry).toHaveBeenCalledWith(expect.objectContaining({ entry: 'Usage', panelId: 'dshfiles-usage', destination: 'observe' }))
    expect(screen.queryByRole('heading', { name: 'Where did a page go?' })).toBeNull()
  })
})
