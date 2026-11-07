// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSelection, DestinationShell, type DestinationShellProps } from './destination-shell.js'
import { MovedTo, MovedToDialog } from './moved-to-dialog.js'
import { DEFAULT_PREFERENCES } from './organization.js'

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
  openMovedTo: vi.fn(),
  useDocking: vi.fn(),
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
    const threadPages = screen.getByRole('navigation', { name: 'Threads pages' })
    expect(
      within(threadPages)
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Board'])
    fireEvent.click(within(threadPages).getByRole('button', { name: 'Board' }))
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

  it('starts fixed and switches to free docking from Settings', () => {
    setPhone(false)
    expect(DEFAULT_PREFERENCES.layoutMode).toBe('fixed')
    const shell = renderShell()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }))
    expect(shell.openSettings).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Free docking' }))
    expect(shell.useDocking).toHaveBeenCalled()
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
    ).toEqual(['Threads', 'Inbox', 'New', 'More'])
    fireEvent.click(within(bar).getByRole('button', { name: 'Inbox' }))
    expect(shell.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(shell.record).toHaveBeenCalledWith({ destination: 'inbox', surface: 'tab-bar' })
    fireEvent.click(within(bar).getByRole('button', { name: 'New' }))
    expect(shell.startSession).toHaveBeenCalled()
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
})

describe('MovedToDialog', () => {
  it('opens a moved page from the moved-to list', () => {
    const openEntry = vi.fn()
    render(<MovedToDialog panels={panels} openEntry={openEntry} />)
    act(() => MovedTo.open())
    expect(screen.getByRole('heading', { name: 'Where did a page go?' })).toBeTruthy()
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open Usage: Analytics in Observe › Usage' }))
    expect(openEntry).toHaveBeenCalledWith(expect.objectContaining({ entry: 'Usage: Analytics', panelId: 'dshfiles-usage', destination: 'observe' }))
    expect(screen.queryByRole('heading', { name: 'Where did a page go?' })).toBeNull()
  })
})
