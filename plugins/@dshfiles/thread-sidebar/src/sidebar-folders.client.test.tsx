// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationSelection, DestinationShell, NEW_FOLDER_EVENT, type DestinationShellProps } from './destination-shell.js'
import { Destinations } from './destinations.js'
import type { FolderActions, SidebarFolderUi } from './sidebar-folders.js'
import { EMPTY_SIDEBAR_TREE, SidebarTreeModel, SidebarTrees, type SidebarTree } from './sidebar-tree.js'
import { WorkbenchPorts } from '@dshfiles/workbench/shell-merge'

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

/** A tree with a user folder "Review" holding Traces (a page) and Changes (a thread facet). */
const reviewTree = (): SidebarTree => {
  const created = SidebarTreeModel.createFolder(EMPTY_SIDEBAR_TREE, { title: 'Review', icon: 'eye' }, 0)
  if (!created.result.ok) throw new Error('create refused')
  const traces = SidebarTreeModel.addPanel(created.result.tree, { viewId: 'traces', folderId: 'review' }, 0)
  if (!traces.ok) throw new Error('add refused')
  const changes = SidebarTreeModel.addPanel(traces.tree, { viewId: 'dshfiles-changes', folderId: 'review', keep: true }, 0)
  if (!changes.ok) throw new Error('add refused')
  return changes.tree
}

const folderUi = (tree: SidebarTree) => {
  const destinations = Destinations.resolve(panels)
  const sections = destinations.flatMap(destination =>
    destination.sections.map(section => ({ panelId: section.panelId, destination: section.destination, label: section.label, unmapped: section.unmapped })),
  )
  const catalog = [
    { id: 'traces', title: 'Traces', kind: 'page' as const },
    { id: 'dshfiles-changes', title: 'Changes', kind: 'facet' as const },
    { id: 'dshfiles-editor.main', title: 'Files', kind: 'view' as const },
  ]
  return {
    folders: SidebarTrees.resolve({ tree, sections, panels: catalog }),
    panels: catalog,
    actions: {
      createFolder: vi.fn<FolderActions['createFolder']>(),
      updateFolder: vi.fn<FolderActions['updateFolder']>(),
      deleteFolder: vi.fn<FolderActions['deleteFolder']>(),
      addPanel: vi.fn<FolderActions['addPanel']>(),
      movePanel: vi.fn<FolderActions['movePanel']>(),
      removePanel: vi.fn<FolderActions['removePanel']>(),
      setKeep: vi.fn<FolderActions['setKeep']>(),
    },
    notice: null,
    dismissNotice: vi.fn<() => void>(),
    open: vi.fn<SidebarFolderUi['open']>(),
  } satisfies SidebarFolderUi
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
  Element.prototype.hasPointerCapture ??= () => false
})

beforeEach(() => {
  DestinationSelection.set('threads')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Sidebar folders on the rail (b:952m)', () => {
  it('lists a user folder in the rail above Settings, with its rows, Add panel and the New folder button', () => {
    setPhone(false)
    const ui = folderUi(reviewTree())
    const shell = renderShell({ folderUi: ui })
    const rail = screen.getByRole('tablist', { name: 'Destinations' })
    expect(
      within(rail)
        .getAllByRole('tab')
        .map(tab => tab.textContent),
    ).toEqual(['Threads', 'Inbox', 'Land', 'Work', 'Agents', 'Observe', 'Knowledge', 'Review', 'Settings'])
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    const rows = screen.getByRole('navigation', { name: 'Review pages' })
    expect(
      within(rows)
        .getAllByRole('button', { name: /^(Traces|Changes)$/u })
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Traces', 'Changes'])
    // Traces moved out of Observe, where it no longer shows.
    fireEvent.click(within(rows).getByRole('button', { name: 'Traces' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('traces')
    fireEvent.click(within(rows).getByRole('button', { name: 'Changes' }))
    expect(ui.open).toHaveBeenCalledWith(expect.objectContaining({ viewId: 'dshfiles-changes', kind: 'facet' }))
    expect(within(rows).getByRole('button', { name: 'Add panel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Observe' }))
    expect(screen.queryByRole('button', { name: 'Traces' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New sidebar folder' })).toBeTruthy()
  })

  it('creates a folder from the New folder dialog and from ⌘K’s event, with a title and an icon', () => {
    setPhone(false)
    const ui = folderUi(EMPTY_SIDEBAR_TREE)
    renderShell({ folderUi: ui })
    fireEvent.click(screen.getByRole('button', { name: 'New sidebar folder' }))
    const dialog = screen.getByRole('dialog', { name: 'New folder' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder name' }), { target: { value: '  Review  ' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'rocket' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }))
    expect(ui.actions.createFolder).toHaveBeenCalledWith('Review', 'rocket')
    act(() => {
      window.dispatchEvent(new CustomEvent(NEW_FOLDER_EVENT))
    })
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeTruthy()
  })

  it('offers Hide on a built-in folder and Rename and Delete on a user folder, and shows hidden folders back', () => {
    setPhone(false)
    const hidden = SidebarTreeModel.updateFolder(reviewTree(), { id: 'agents', hidden: true }, 0)
    if (!hidden.ok) throw new Error('hide refused')
    const ui = folderUi(hidden.tree)
    renderShell({ folderUi: ui })
    expect(screen.queryByRole('tab', { name: 'Agents' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    expect(screen.getByRole('button', { name: 'Folder options: Review' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New sidebar folder' }))
    const section = screen.getByRole('region', { name: 'Hidden folders' })
    fireEvent.click(within(section).getByRole('button', { name: 'Show' }))
    expect(ui.actions.updateFolder).toHaveBeenCalledWith('agents', { hidden: false })
  })

  it('collapsed, opens a folder’s rows in a flyout instead of expanding the column', () => {
    setPhone(false)
    const ui = folderUi(reviewTree())
    const shell = renderShell({ folderUi: ui, collapsed: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    expect(shell.toggleSidebar).not.toHaveBeenCalled()
    const flyout = screen.getByRole('dialog', { name: 'Review' })
    fireEvent.click(within(flyout).getByRole('button', { name: 'Traces' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('traces')
    // Threads keeps expanding the column: its list is the thread list.
    fireEvent.click(screen.getByRole('tab', { name: 'Threads' }))
    expect(shell.toggleSidebar).toHaveBeenCalled()
  })

  it('shows the thread list again after Reset layout, wherever the rail was', () => {
    setPhone(false)
    renderShell({ folderUi: folderUi(reviewTree()) })
    fireEvent.click(screen.getByRole('tab', { name: 'Observe' }))
    expect(screen.getByRole('tab', { name: 'Observe' }).getAttribute('aria-selected')).toBe('true')
    act(() => WorkbenchPorts.layoutReset().notify())
    expect(screen.getByRole('tab', { name: 'Threads' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Thread list')).toBeTruthy()
  })

  it('on a phone, More lists every folder without a tab, user folders included, each expanding to its rows', () => {
    setPhone(true)
    const ui = folderUi(reviewTree())
    const shell = renderShell({ folderUi: ui })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const more = screen.getByRole('navigation', { name: 'More destinations' })
    expect([...more.querySelectorAll('[data-destination]')].map(row => row.getAttribute('data-destination'))).toEqual([
      'work',
      'agents',
      'observe',
      'knowledge',
      'review',
      'settings',
    ])
    fireEvent.click(within(more).getByRole('button', { name: 'Show Review pages' }))
    const rows = within(more).getByRole('navigation', { name: 'Review pages' })
    fireEvent.click(within(rows).getByRole('button', { name: 'Traces' }))
    expect(shell.selectPanel).toHaveBeenCalledWith('traces')
  })
})
