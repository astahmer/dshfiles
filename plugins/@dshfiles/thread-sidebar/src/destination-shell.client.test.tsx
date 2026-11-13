// @vitest-environment jsdom
import { ListHeaderExtras } from './list-header-extras.js'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSelection, DestinationShell, type DestinationShellProps } from './destination-shell.js'
import { MovedTo, MovedToDialog } from './moved-to-dialog.js'

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
    ).toEqual(['Threads', 'Inbox', 'Land', 'Work', 'Agents', 'Observe', 'Knowledge', 'Settings'])
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

  it('collapsed, keeps only the rail and expands on a destination', () => {
    setPhone(false)
    const shell = renderShell({ collapsed: true })
    expect(screen.queryByText('Thread list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(shell.startSession).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Land' }))
    expect(shell.toggleSidebar).toHaveBeenCalled()
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
