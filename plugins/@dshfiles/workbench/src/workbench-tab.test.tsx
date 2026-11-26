import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createDockview, type DockviewApi, type IDockviewPanel } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkbenchTabsProvider } from './tabs.js'
import { ContextMenuItem } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { createWorkbenchPanelRegistry, type WorkbenchPanelDefinition } from './registry.js'
import { connectWorkbenchTabs, type CloseButtonPosition, type WorkbenchTab, type WorkbenchTabsActions, type WorkbenchTabsSnapshot } from './tabs.js'
import { createWorkbenchTab, WorkbenchNewTabButton } from './workbench-tab.js'
import { TabRows } from './tab-row-visibility.js'
import { TabReveal } from './tab-reveal.js'

// Round nine B2: the pages that name themselves on their tab (settings-shell provides them through TabPlaceGlyphs).
const registry = vi.hoisted(() => {
  const places: Array<{ readonly panelId: string; readonly glyph: () => JSX.Element; readonly tone: string }> = []
  return { places }
})
vi.mock('@dshfiles/dshx/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@dshfiles/dshx/client')>()
  return {
    ...actual,
    useRegistry: (token: Parameters<typeof actual.useRegistry>[0]) =>
      token.id === '@dshfiles/workbench.tab-place-glyph' ? registry.places : actual.useRegistry(token),
  }
})

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  HTMLElement.prototype.scrollIntoView ??= () => {}
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
    readonly closeButtonPosition?: CloseButtonPosition
    readonly projectNames?: Readonly<Record<string, string>>
    readonly projectChips?: Readonly<Record<string, { readonly className?: string; readonly color?: string; readonly tone?: number }>>
    readonly presentation?: Pick<WorkbenchTabsProvider, 'renderTabMenu' | 'label'>
    readonly tab?: WorkbenchTab
  } = {},
) => {
  const initial: WorkbenchTab = options.tab ?? {
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
  let snapshot: WorkbenchTabsSnapshot = {
    enabled: options.enabled ?? true,
    scopeKey: 'project:test',
    activeTabId: initial.id,
    tabs: [initial],
  }
  if (options.closeButtonPosition !== undefined) snapshot = { ...snapshot, closeButtonPosition: options.closeButtonPosition }
  if (options.projectNames !== undefined) snapshot = { ...snapshot, projectNames: options.projectNames }
  if (options.projectChips !== undefined) snapshot = { ...snapshot, projectChips: options.projectChips }
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
      snapshot = { ...snapshot, tabs: [initial.kind === 'thread' ? { ...initial, ...patch } : initial] }
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
  /** The docking verbs live one level down, under Layout. */
  const layoutMenu = () => {
    menu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout' }))
  }
  return { api, panel, actions, view, update, trigger, menu, layoutMenu }
}

describe('workbench semantic tab chrome', () => {
  it('leaves strip scrolling to Dockview when the tab mounts and its title changes', () => {
    const reveal = vi.spyOn(TabReveal, 'reveal')
    const tab = fixture()
    expect(reveal).not.toHaveBeenCalled()
    tab.update({ title: 'Thread A with a much longer title than the placeholder' })
    expect(reveal).not.toHaveBeenCalled()
    reveal.mockRestore()
  })

  it('shows the project as a ProjectMark tile before a thread title, named for assistive tech', () => {
    const tab = fixture({ projectNames: { 'workspace-a': 'NixConfig' } })
    tab.update({ workspaceId: 'workspace-a' })
    const mark = screen.getByRole('img', { name: 'NixConfig' })
    const title = screen.getByText('Thread A')
    expect(mark.getAttribute('data-workbench-tab-project')).toBe('')
    expect(mark.getAttribute('data-slot')).toBe('project-mark')
    expect(mark.getAttribute('data-size')).toBe('dense')
    expect(mark.textContent).toBe('NI')
    expect(mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // No rose pill: the tile carries the colour, the name is not repeated as tinted text.
    expect(screen.queryByText('NixConfig')).toBeNull()
  })

  it('paints the tile in the project\'s chosen tone', () => {
    const tab = fixture({ projectNames: { 'workspace-a': 'NixConfig' }, projectChips: { 'workspace-a': { className: 'project-tone-balanced-3', tone: 3 } } })
    tab.update({ workspaceId: 'workspace-a' })
    expect(screen.getByRole('img', { name: 'NixConfig' }).className).toContain('project-tone-balanced-3')
  })

  it('keeps a custom tile colour readable by clamping its lightness in each scheme', () => {
    const tab = fixture({ projectNames: { 'workspace-a': 'NixConfig' }, projectChips: { 'workspace-a': { color: '#ffd400' } } })
    tab.update({ workspaceId: 'workspace-a' })
    const mark = screen.getByRole('img', { name: 'NixConfig' })
    // The pick rides as --chip; the tile is the pick at L ≤ 0.52 in light and L ≥ 0.78 in dark.
    expect(mark.style.getPropertyValue('--chip')).toBe('#ffd400')
    expect(mark.style.color).toBe('var(--chip-clamped)')
    expect(mark.style.getPropertyValue('--chip-light')).toBe('oklch(from var(--chip) min(l, 0.52) c h)')
    expect(mark.style.getPropertyValue('--chip-dark')).toBe('oklch(from var(--chip) max(l, 0.78) c h)')
    expect(mark.className).toContain('dshx:[--chip-clamped:var(--chip-light)]')
    expect(mark.className).toContain('dshx:dark:[--chip-clamped:var(--chip-dark)]')
  })

  it('names a page tab\'s destination with its rail glyph, in its nav tone while the tab is on screen (round five B4)', () => {
    fixture({
      tab: {
        id: 'panel:backlog',
        kind: 'panel',
        panelId: 'dshfiles-backlog-panel',
        destination: { id: 'work', icon: 'list-todo' },
        target: { kind: 'panel', panelId: 'dshfiles-backlog-panel' },
        title: 'Backlog',
        active: true,
        pinned: false,
        preview: false,
        available: true,
        status: null,
      },
    })
    const glyph = document.querySelector<HTMLElement>('[data-tab-destination]')
    expect(glyph?.getAttribute('data-tab-destination')).toBe('work')
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(glyph?.className).toContain('dshx:nav-tone-work')
    // Tertiary on a background tab; the tone only where Dockview marks the tab active. The label stays ink.
    expect(glyph?.className).toContain('dshx:text-(--dsw-alias-label-tertiary)')
    expect(glyph?.className).toContain('dshx:in-[.dv-active-tab]:text-nav-tone')
    // Round nine B2: the active tab's glyph on its tone's 14% tile.
    expect(glyph?.className).toContain('dshx:in-[.dv-active-tab]:bg-nav-tile')
    expect(glyph?.querySelector('svg')?.getAttribute('width')).toBe('14')
    expect(glyph?.getAttribute('data-tab-place')).toBeNull()
    expect((glyph?.compareDocumentPosition(screen.getByText('Registered title')) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names a page with its own place glyph by that glyph in its tone, not its destination\'s (round nine B2)', () => {
    registry.places = [{ panelId: 'ai-accounts', glyph: () => <svg data-testid="leaf" />, tone: 'var(--dshx-identity-2)' }]
    fixture({
      tab: {
        id: 'panel:ai-accounts',
        kind: 'panel',
        panelId: 'ai-accounts',
        destination: { id: 'settings', icon: 'settings' },
        target: { kind: 'panel', panelId: 'ai-accounts' },
        title: 'AI accounts',
        active: true,
        pinned: false,
        preview: false,
        available: true,
        status: null,
      },
    })
    const glyph = document.querySelector<HTMLElement>('[data-tab-destination]')
    expect(glyph?.getAttribute('data-tab-place')).toBe('ai-accounts')
    expect(glyph?.querySelector('[data-testid="leaf"]')).not.toBeNull()
    expect(glyph?.style.getPropertyValue('--dshx-nav-tone')).toBe('var(--dshx-identity-2)')
    expect(glyph?.className).not.toContain('dshx:nav-tone-settings')
    expect(glyph?.className).toContain('dshx:in-[.dv-active-tab]:bg-nav-tile')
    registry.places = []
  })

  it('seats the compose glyph in the Threads tone on a new thread tab, which has no status and no project yet (council round 6 B6)', () => {
    const tab = fixture()
    tab.update({ status: null, title: 'New thread' })
    const seat = document.querySelector<HTMLElement>('[data-tab-status-slot]')
    const glyph = seat?.querySelector<HTMLElement>('[data-tab-compose]')
    expect(glyph).not.toBeNull()
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(glyph?.className).toContain('dshx:nav-tone-threads')
    expect(glyph?.className).toContain('dshx:in-[.dv-active-tab]:text-nav-tone')
    // A running thread shows its status there instead; a thread in a project shows the project's tile.
    tab.update({ status: 'running' })
    expect(document.querySelector('[data-tab-compose]')).toBeNull()
    cleanup()
    const inProject = fixture({ projectNames: { 'workspace-a': 'NixConfig' } })
    inProject.update({ status: null, workspaceId: 'workspace-a' })
    expect(document.querySelector('[data-tab-compose]')).toBeNull()
  })

  it('keeps the ProjectMark, not a destination glyph, on a thread tab', () => {
    fixture()
    expect(document.querySelector('[data-tab-destination]')).toBeNull()
  })

  it('starts every tab\'s content 12px from its edge', () => {
    fixture()
    const content = document.querySelector<HTMLElement>('[data-workbench-tab-id]')
    expect(content?.className).toContain('dshx:pl-3')
  })

  it('hides the project chip without a project name for the tab', () => {
    fixture({ projectNames: { 'workspace-a': 'NixConfig' } })
    expect(document.querySelector('[data-workbench-tab-project]')).toBeNull()
  })

  it('defaults missing close-button metadata to the right of the Workbench tab title, VS Code style', () => {
    const tab = fixture()
    const closeButton = screen.getByRole('button', { name: 'Close Thread A' })
    const title = screen.getByText('Thread A')
    expect(title.compareDocumentPosition(closeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tab.actions.close).not.toHaveBeenCalled()
  })

  it('places the Workbench close button before the title when configured left', () => {
    fixture({ closeButtonPosition: 'left' })
    const closeButton = screen.getByRole('button', { name: 'Close Thread A' })
    const title = screen.getByText('Thread A')
    expect(closeButton.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

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
    expect(screen.getByLabelText('Working')).toBeTruthy()
    expect(trigger.getAttribute('data-preview')).toBe('true')
    tab.update({ title: 'Renamed', status: 'unread', pinned: true, preview: false })
    expect(tab.trigger()).toBe(trigger)
    expect(screen.getByText('Renamed')).toBeTruthy()
    expect(screen.getByLabelText('Ready')).toBeTruthy()
    expect(screen.getByLabelText('Pinned')).toBeTruthy()
    expect(screen.queryByLabelText('Working')).toBeNull()
    expect(trigger.hasAttribute('data-preview')).toBe(false)
  })

  it('draws the shared status glyph for every tab status and never a coloured dot of its own', () => {
    const tab = fixture()
    const glyph = () => tab.view.container.querySelector('[data-slot="status-glyph"]')
    expect(glyph()?.getAttribute('data-status')).toBe('working')
    expect(tab.view.container.innerHTML).not.toMatch(/bg-info|bg-warning|animate-pulse/)
    tab.update({ status: 'needsYou' })
    expect(glyph()?.getAttribute('data-status')).toBe('needs-you')
    expect(tab.view.container.innerHTML).not.toMatch(/bg-info|bg-warning|animate-pulse/)
    tab.update({ status: 'failed' })
    expect(glyph()?.getAttribute('data-status')).toBe('failed')
    tab.update({ status: 'unread' })
    expect(glyph()?.getAttribute('data-status')).toBe('ready')
    tab.update({ status: null })
    expect(glyph()).toBeNull()
  })

  it('keeps a 16 px status seat on a thread tab, so its title does not move when a thread starts or stops', () => {
    // The glyph mounted only with a status: the title moved 24 px at each start and end of a turn (F13).
    const tab = fixture()
    const seat = () => tab.view.container.querySelector('[data-tab-status-slot]')
    expect(seat()?.className).toContain('dshx:size-4')
    expect(seat()?.childElementCount).toBe(1)
    tab.update({ status: null })
    expect(seat()?.className).toContain('dshx:size-4')
    // No status glyph; without a project the seat shows the compose glyph instead (council round 6 B6).
    expect(seat()?.querySelector('[data-tab-status]')).toBeNull()
  })

  it('draws every tab not on screen in one ink, preview or kept (council round 18 B2.1), and caps the title with an ellipsis', () => {
    const tab = fixture()
    const title = screen.getByText('Thread A')
    // The preview stays in the DOM, but its title takes no ink of its own: a muted preview beside an ink kept tab read
    // as two inks for one state.
    expect(tab.trigger().getAttribute('data-preview')).toBe('true')
    expect(title.className).not.toContain('italic')
    expect(title.className).not.toContain('dshx:text-muted-foreground')
    expect(title.className).toContain('dshx:truncate')
    expect(title.className).toContain('dshx:max-w-56')
    // The tab's own `.dshx-root` reset its ink to the primary label, over Dockview's per-state tab ink: a kept inactive
    // tab drew in ink. The content inherits the `.dv-tab` colour instead.
    expect(tab.trigger().className).toContain('dshx-root')
    expect(tab.trigger().className).toContain('dshx:text-inherit')
    tab.update({ preview: false })
    expect(screen.getByText('Thread A').className).not.toContain('dshx:text-muted-foreground')
  })

  it('gives every inactive tab the secondary ink in the Dockview theme, in and outside the focused group', () => {
    const css = readFileSync('src/dockview-theme.css', 'utf8')
    const ink = (name: string): string | undefined => new RegExp(`--dv-${name}-tab-color: ([^;]+);`, 'u').exec(css)?.[1]
    expect(ink('activegroup-visiblepanel')).toBe('var(--dsw-alias-label-primary)')
    expect(ink('activegroup-hiddenpanel')).toBe('var(--dsw-alias-label-secondary)')
    expect(ink('inactivegroup-visiblepanel')).toBe('var(--dsw-alias-label-secondary)')
    expect(ink('inactivegroup-hiddenpanel')).toBe('var(--dsw-alias-label-secondary)')
  })

  it('draws the title of the tab on screen in ink at 500, even while it is a preview (round five B5)', () => {
    fixture()
    const title = screen.getByText('Thread A')
    expect(title.className).toContain('dshx:in-[.dv-active-tab]:text-foreground')
    expect(title.className).toContain('dshx:in-[.dv-active-tab]:font-medium')
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

  it('keeps tab verbs at the top level and puts the docking verbs under one Layout submenu', () => {
    const tab = fixture()
    tab.menu()
    const topLevel = (): string[] => screen.getAllByRole('menuitem').map(item => item.textContent ?? '')
    expect(topLevel()).toEqual(['Keep tab', 'Pin tab', 'Move to side panel', 'Close tab', 'Close other tabs', 'Close tabs to the right', 'Layout'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout' }))
    expect(screen.getByRole('menuitem', { name: 'Float panel' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Hide tab row' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Close panel' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }))
    expect(tab.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
  })

  it('names the close verb of a panel without a semantic tab Close tab as well', () => {
    const tab = fixture({ semantic: false })
    tab.menu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Close tab', 'Close other tabs', 'Close tabs to the right', 'Layout'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }))
    expect(tab.api.getPanel(tab.panel.id)).toBeUndefined()
    expect(tab.actions.close).not.toHaveBeenCalled()
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
    tab.layoutMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide tab row' }))
    expect(tab.panel.group.header.hidden).toBe(true)
    expect(tab.api.getPanel(tab.panel.id)).toBe(tab.panel)
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.actions.activate).not.toHaveBeenCalled()
  })

  it('disables hiding a multi-tab row and rechecks eligibility after the menu opens', () => {
    const tab = fixture()
    tab.layoutMenu()
    const hide = screen.getByRole('menuitem', { name: 'Hide tab row' })
    act(() => tab.api.addPanel({ id: 'second', component: 'body', position: { referenceGroup: tab.panel.group } }))
    fireEvent.click(hide)
    expect(tab.panel.group.header.hidden).toBe(false)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    tab.layoutMenu()
    expect(screen.getByRole('menuitem', { name: 'Hide tab row' }).getAttribute('data-disabled')).toBe('')
  })

  it('floats the real panel and leaves the semantic actor unchanged', () => {
    const tab = fixture()
    tab.layoutMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Float panel' }))
    expect(tab.panel.group.api.location.type).toBe('floating')
    expect(tab.actions.close).not.toHaveBeenCalled()
    expect(tab.actions.activate).not.toHaveBeenCalled()
  })

  it('hides the close cross for pinned tabs while preserving context and middle-click close semantics', () => {
    const tab = fixture({ pinned: true, closeButtonPosition: 'right' })
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
