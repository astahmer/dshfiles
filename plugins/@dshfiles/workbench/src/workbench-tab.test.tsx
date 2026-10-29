import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createDockview, type DockviewApi, type IDockviewPanel } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkbenchTabsProvider } from './tabs.js'
import { ContextMenuItem } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { createWorkbenchPanelRegistry, type WorkbenchPanelDefinition } from './registry.js'
import { connectWorkbenchTabs, type WorkbenchTab, type WorkbenchTabsActions, type WorkbenchTabsSnapshot } from './tabs.js'
import { createWorkbenchTab, WorkbenchNewTabButton } from './workbench-tab.js'
import { TabRows } from './tab-row-visibility.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const disposers: Array<() => void> = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
  globalThis.dshfilesWorkbenchTabsV1 = undefined
  document.body.replaceChildren()
})

const fixture = (
  options: {
    readonly enabled?: boolean
    readonly pinned?: boolean
    readonly semantic?: boolean
    readonly presentation?: Pick<WorkbenchTabsProvider, 'renderTabMenu' | 'label'>
  } = {},
) => {
  const initial: WorkbenchTab = {
    id: 'thread:a',
    kind: 'thread',
    sessionId: 'a',
    target: { kind: 'thread', sessionId: 'a' },
    title: 'Thread A',
    active: true,
    pinned: options.pinned ?? false,
    preview: true,
    available: true,
    status: 'running',
  }
  let snapshot: WorkbenchTabsSnapshot = { enabled: options.enabled ?? true, scopeKey: 'project:test', activeTabId: initial.id, tabs: [initial] }
  const listeners = new Set<() => void>()
  const actions: WorkbenchTabsActions = {
    activate: vi.fn(),
    close: vi.fn(),
    keep: vi.fn(),
    togglePin: vi.fn(),
    move: vi.fn(),
    closeOthers: vi.fn(),
    closeToRight: vi.fn(),
    moveAside: vi.fn(() => false),
    open: vi.fn(),
    newTab: vi.fn(),
    renameThread: vi.fn(async () => undefined),
  }
  disposers.push(
    connectWorkbenchTabs({
      getSnapshot: () => snapshot,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      actions,
      renderStart: () => null,
      ...options.presentation,
    }),
  )
  const element = document.createElement('div')
  document.body.append(element)
  const api: DockviewApi = createDockview(element, { createComponent: () => ({ element: document.createElement('div'), init: () => undefined }) })
  api.layout(1000, 600)
  disposers.push(() => api.dispose())
  disposers.push(TabRows.retain(api, () => undefined).dispose)
  const panel: IDockviewPanel = api.addPanel({ id: 'panel-a', component: 'body', title: 'Fallback title' })
  const registry = createWorkbenchPanelRegistry()
  const definition: WorkbenchPanelDefinition = { id: panel.id, title: 'Registered title', component: () => null }
  if (options.semantic === false) registry.register(definition)
  else registry.register({ ...definition, tabId: initial.id, beforeClose: () => actions.close(initial.id) })
  const Tab = createWorkbenchTab(registry)
  const view = render(<Tab api={panel.api} containerApi={api} params={{}} tabLocation="header" />)
  const update = (patch: Partial<Extract<WorkbenchTab, { kind: 'thread' }>>) =>
    act(() => {
      snapshot = { ...snapshot, tabs: [{ ...initial, ...patch }] }
      for (const listener of listeners) listener()
    })
  const trigger = () => {
    const node = view.container.querySelector('[data-state]')
    if (!(node instanceof HTMLElement)) throw new Error('Tab menu trigger missing')
    return node
  }
  const menu = () => {
    fireEvent.contextMenu(trigger(), { button: 2, clientX: 20, clientY: 20 })
  }
  return { api, panel, actions, view, update, trigger, menu }
}

describe('workbench semantic tab chrome', () => {
  it('closes through the semantic owner without closing its already-retired Dockview presentation again', () => {
    const tab = fixture()
    act(() => tab.api.addPanel({ id: 'survivor', component: 'body' }))
    vi.mocked(tab.actions.close).mockImplementation(() => {
      const owned = tab.api.getPanel(tab.panel.id)
      if (owned !== undefined) tab.api.removePanel(owned)
    })
    const closePresentation = vi.spyOn(tab.panel.api, 'close')
    fireEvent.click(screen.getByRole('button', { name: 'Close Thread A' }))
    expect(tab.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(closePresentation).not.toHaveBeenCalled()
    expect(tab.api.panels.map(panel => panel.id)).toEqual(['survivor'])
  })

  it('activates an inactive semantic tab directly on its explicit pointer gesture', () => {
    const tab = fixture()
    act(() => tab.api.addPanel({ id: 'other-panel', component: 'body' }))
    expect(tab.panel.api.isActive).toBe(false)
    fireEvent(tab.trigger(), new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(tab.actions.activate).toHaveBeenCalledExactlyOnceWith('thread:a')
  })

  it('acknowledges an already active thread on re-click without activating its close control', () => {
    const tab = fixture()
    expect(tab.panel.api.isActive).toBe(true)
    fireEvent(tab.trigger(), new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(tab.actions.activate).toHaveBeenCalledExactlyOnceWith('thread:a')
    fireEvent(within(tab.view.container).getByRole('button', { name: 'Close Thread A' }), new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(tab.actions.activate).toHaveBeenCalledTimes(1)
  })

  it('opens the existing Start tab from an accessible new-tab header action and hides it without the provider', () => {
    const tab = fixture()
    render(<WorkbenchNewTabButton label="New tab" />)
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    expect(tab.actions.newTab).toHaveBeenCalledTimes(1)
    expect(tab.actions.open).not.toHaveBeenCalled()
    cleanup()
    for (const dispose of disposers.splice(0).reverse()) dispose()
    globalThis.dshfilesWorkbenchTabsV1 = undefined
    render(<WorkbenchNewTabButton label="New tab" />)
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull()
  })

  it('uses the localized compact header action and hides it for a disabled provider', () => {
    const tab = fixture({ enabled: false })
    render(<WorkbenchNewTabButton label="新建标签页" />)
    expect(screen.queryByRole('button', { name: '新建标签页' })).toBeNull()
    cleanup()
    for (const dispose of disposers.splice(0).reverse()) dispose()
    globalThis.dshfilesWorkbenchTabsV1 = undefined
    const enabled = fixture()
    render(<WorkbenchNewTabButton label="新建标签页" />)
    const button = screen.getByRole('button', { name: '新建标签页' })
    expect(within(button).getByText('新建标签页').classList.contains('dshx:@max-pane-compact:sr-only')).toBe(true)
    fireEvent.click(button)
    expect(enabled.actions.newTab).toHaveBeenCalledTimes(1)
    expect(enabled.actions.open).not.toHaveBeenCalled()
    expect(tab.actions.newTab).not.toHaveBeenCalled()
  })

  it('keeps the same mounted tab node while title, unread, preview and pin metadata change', () => {
    const tab = fixture()
    const trigger = tab.trigger()
    expect(screen.getByText('Thread A')).toBeTruthy()
    expect(screen.getByLabelText('running')).toBeTruthy()
    expect(trigger.getAttribute('data-preview')).toBe('true')
    tab.update({ title: 'Renamed', status: 'unread', pinned: true, preview: false })
    expect(tab.trigger()).toBe(trigger)
    expect(screen.getByText('Renamed')).toBeTruthy()
    expect(screen.getByLabelText('unread')).toBeTruthy()
    expect(screen.getByLabelText('Pinned')).toBeTruthy()
    expect(screen.queryByLabelText('running')).toBeNull()
    expect(trigger.hasAttribute('data-preview')).toBe(false)
  })

  it('keeps a preview on double click and delegates close exactly once without archiving', () => {
    const tab = fixture()
    fireEvent.doubleClick(tab.trigger())
    expect(tab.actions.keep).toHaveBeenCalledExactlyOnceWith('thread:a')
    fireEvent.click(screen.getByRole('button', { name: 'Close Thread A' }))
    expect(tab.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(tab.api.getPanel(tab.panel.id)).toBeUndefined()
  })

  it('middle-click closes once and preserves a tab when the aside owner declines', () => {
    const tab = fixture()
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to side panel' }))
    expect(tab.actions.moveAside).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.api.getPanel(tab.panel.id)).toBe(tab.panel)
    fireEvent(tab.trigger(), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(tab.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(tab.api.getPanel(tab.panel.id)).toBeUndefined()
  })

  it('routes pin and close-neighbour context actions by semantic id', () => {
    const tab = fixture()
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin tab' }))
    expect(tab.actions.togglePin).toHaveBeenCalledExactlyOnceWith('thread:a')
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }))
    expect(tab.actions.closeOthers).toHaveBeenCalledExactlyOnceWith('thread:a')
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(tab.actions.closeToRight).toHaveBeenCalledExactlyOnceWith('thread:a')
  })

  it('uses the provider menu and localized chrome without duplicating semantic actions', async () => {
    const renderTabMenu = vi.fn((_id: string, onRename: () => void, onStatus?: (message: string) => void) => (
      <>
        <ContextMenuItem onSelect={onRename}>Renommer</ContextMenuItem>
        <ContextMenuItem onSelect={() => onStatus?.('Action refusée')}>Signaler</ContextMenuItem>
      </>
    ))
    const tab = fixture({ presentation: { renderTabMenu, label: (key, title) => (key === 'closeTab' ? `Fermer ${title}` : `fr:${key}`) } })
    expect(screen.getByLabelText('fr:running')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fermer Thread A' })).toBeTruthy()
    tab.menu()
    expect(screen.queryByRole('menuitem', { name: 'Keep tab' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Signaler' }))
    expect(within(tab.view.container).getByRole('status').textContent).toBe('Action refusée')
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renommer' }))
    const editor = screen.getByRole('textbox', { name: 'fr:renameThread' })
    fireEvent.change(editor, { target: { value: 'Nouveau titre' } })
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Enter' })
    })
    expect(tab.actions.renameThread).toHaveBeenCalledExactlyOnceWith('a', 'Nouveau titre')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(within(tab.view.container).queryByRole('status')).toBeNull()
    expect(tab.actions.keep).not.toHaveBeenCalled()
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(renderTabMenu).toHaveBeenCalledWith('thread:a', expect.any(Function), expect.any(Function))
  })

  it('reports a failed provider rename without closing the panel or changing navigation', async () => {
    const tab = fixture({
      presentation: { renderTabMenu: (_id, onRename) => <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>, label: key => `localized:${key}` },
    })
    vi.mocked(tab.actions.renameThread).mockRejectedValueOnce(new Error('Host refused'))
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const editor = screen.getByRole('textbox', { name: 'localized:renameThread' })
    fireEvent.change(editor, { target: { value: 'Rejected title' } })
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Enter' })
    })
    expect(within(tab.view.container).getByRole('status').textContent).toBe('localized:renameFailed')
    expect(tab.api.getPanel(tab.panel.id)).toBe(tab.panel)
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.actions.activate).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Escape' })
  })

  it('closes the other native tabs of its group, or only those to its right', () => {
    const tab = fixture({ semantic: false })
    act(() => {
      tab.api.addPanel({ id: 'second', component: 'body', position: { referenceGroup: tab.panel.group } })
      tab.api.addPanel({ id: 'third', component: 'body', position: { referenceGroup: tab.panel.group } })
    })
    act(() => tab.panel.api.setActive())
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(tab.panel.group.panels.map(panel => panel.id)).toEqual(['panel-a'])

    act(() => tab.api.addPanel({ id: 'fourth', component: 'body', position: { referenceGroup: tab.panel.group } }))
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }))
    expect(tab.panel.group.panels.map(panel => panel.id)).toEqual(['panel-a'])
    tab.menu()
    expect(screen.getByRole('menuitem', { name: 'Close other tabs' }).getAttribute('data-disabled')).toBe('')
    expect(screen.getByRole('menuitem', { name: 'Close tabs to the right' }).getAttribute('data-disabled')).toBe('')
    expect(tab.actions.close).not.toHaveBeenCalled()
  })

  it('hides only a single native tab row without closing or navigating its panel', () => {
    const tab = fixture({ semantic: false })
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide tab row' }))
    expect(tab.panel.group.header.hidden).toBe(true)
    expect(tab.api.getPanel(tab.panel.id)).toBe(tab.panel)
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.actions.activate).not.toHaveBeenCalled()
  })

  it('disables hiding a multi-tab row and rechecks eligibility after the menu opens', () => {
    const tab = fixture()
    tab.menu()
    const hide = screen.getByRole('menuitem', { name: 'Hide tab row' })
    act(() => tab.api.addPanel({ id: 'second', component: 'body', position: { referenceGroup: tab.panel.group } }))
    fireEvent.click(hide)
    expect(tab.panel.group.header.hidden).toBe(false)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    tab.menu()
    expect(screen.getByRole('menuitem', { name: 'Hide tab row' }).getAttribute('data-disabled')).toBe('')
  })

  it('floats the real panel and leaves the semantic actor unchanged', () => {
    const tab = fixture()
    tab.menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Float panel' }))
    expect(tab.panel.group.api.location.type).toBe('floating')
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.actions.activate).not.toHaveBeenCalled()
  })

  it('hides the close cross for pinned tabs while preserving context and middle-click close semantics', () => {
    const tab = fixture({ pinned: true })
    expect(screen.getByLabelText('Pinned')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close Thread A' })).toBeNull()
    tab.menu()
    expect(screen.getByRole('menuitem', { name: 'Unpin tab' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent(tab.trigger(), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(tab.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
  })

  it('closes an ordinary workbench panel without inventing a semantic tab', () => {
    const tab = fixture({ semantic: false })
    expect(screen.getByText('Registered title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Registered title' }))
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.api.getPanel(tab.panel.id)).toBeUndefined()
  })
})
