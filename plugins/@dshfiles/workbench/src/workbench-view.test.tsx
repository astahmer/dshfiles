import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createDockview, LocalSelectionTransfer, Orientation, PanelTransfer, type DockviewApi } from 'dockview-react'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLayoutStore, WORKBENCH_COMPONENT } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { createWorkbenchPanelRegistry, type WorkbenchPanelProps, type WorkbenchPanelRegistry } from './registry.js'
import { WorkbenchView } from './workbench-view.js'
import { connectWorkbenchTabs, type WorkbenchTabsSnapshot } from './tabs.js'
import { NewViewTabs } from './new-view.js'
import { workbenchRegions } from './dock-regions.js'
import { canMovePanelToRegion, nestedPanelId, nestedSurfacePath } from './nested-surfaces.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

const semanticDisposers: Array<() => void> = []
afterEach(() => {
  cleanup()
  for (const dispose of semanticDisposers.splice(0).reverse()) dispose()
})

const t: WorkbenchTranslate = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)

const memoryStorage = () => {
  const values = new Map<string, string>()
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
}

const mounts = new Map<string, number>()

const DraftPanel = (props: WorkbenchPanelProps): JSX.Element => {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    mounts.set(props.panelId, (mounts.get(props.panelId) ?? 0) + 1)
  }, [props.panelId])
  return <textarea aria-label={`draft ${props.panelId}`} value={draft} onChange={event => setDraft(event.target.value)} />
}

const registryWith = (...ids: string[]): WorkbenchPanelRegistry => {
  const registry = createWorkbenchPanelRegistry()
  for (const id of ids) registry.register({ id, title: id, component: DraftPanel })
  return registry
}

/** One dock-preferred panel, one Editor and one ordinary panel: each surface's default layout names a different one. */
const mixedRegistry = (): WorkbenchPanelRegistry => {
  const registry = createWorkbenchPanelRegistry()
  registry.register({ id: 'other.panel', title: 'other', component: DraftPanel })
  registry.register({ id: 'dshfiles-editor.main', title: 'editor', component: DraftPanel })
  registry.register({ id: 'jujutsu.dock', title: 'jujutsu', component: DraftPanel, dockDefault: true })
  return registry
}

const renderWorkbench = (registry: WorkbenchPanelRegistry, storage = memoryStorage(), surface?: 'main' | 'side-panel' | 'dock' | 'bottom') => {
  let api: DockviewApi | undefined
  const store = createLayoutStore({ storage })
  const view = render(<WorkbenchView registry={registry} store={store} t={t} onApi={ready => (api = ready)} {...(surface === undefined ? {} : { surface })} />)
  if (api === undefined) throw new Error('Dockview did not become ready')
  return { api, store, storage, view }
}

/** The parent's retained right pane: adoption precedes visibility, and close does not dispose the API. */
const renderRightWorkbench = (...ids: string[]) => {
  const registry = registryWith(...ids)
  const store = createLayoutStore({ surface: 'dock', storage: memoryStorage() })
  const onClose = vi.fn()
  let api: DockviewApi | undefined
  const onApi = vi.fn((ready: DockviewApi) => {
    api = ready
    for (const id of ids) ready.addPanel({ id, title: id, component: WORKBENCH_COMPONENT })
  })
  const pane = (visible: boolean) => (
    <WorkbenchView registry={registry} store={store} t={t} region="right" surface="dock" visible={visible} onClose={onClose} onApi={onApi} />
  )
  const view = render(pane(true))
  if (api === undefined) throw new Error('Right Dockview did not become ready')
  return { api, store, registry, onClose, onApi, view, setVisible: (visible: boolean) => view.rerender(pane(visible)) }
}

/** Dockview buffers layout-change events to the next task, and the store saves on that event. */
const flushLayoutChange = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

/** A surface wired to record the panels the embedder is asked to adopt, with its Dockview element. */
const renderDropZone = (registry: WorkbenchPanelRegistry, surface: 'main' | 'dock' | 'bottom') => {
  const dropped = vi.fn()
  const store = createLayoutStore({ storage: memoryStorage() })
  let api: DockviewApi | undefined
  const view = render(<WorkbenchView registry={registry} store={store} t={t} surface={surface} onApi={ready => (api = ready)} onDropPanel={dropped} />)
  const element = view.container.querySelector('.dv-dockview')
  if (api === undefined || element === null) throw new Error('Dockview did not become ready')
  return { api, dropped, element, view }
}

/** Dockview stores a drag's payload in its own page-global transfer, keyed by the transfer class. */
const dragPayloadOf = (transfer: PanelTransfer, run: () => void): void => {
  LocalSelectionTransfer.getInstance().setData([transfer], PanelTransfer.prototype)
  try {
    run()
  } finally {
    LocalSelectionTransfer.getInstance().clearData(PanelTransfer.prototype)
  }
}

const draftOf = (id: string): HTMLTextAreaElement => {
  const element = screen.getByLabelText(`draft ${id}`)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`${id} is not a textarea`)
  return element
}

const renderSemanticWorkbench = () => {
  const activate = vi.fn()
  const snapshot: WorkbenchTabsSnapshot = {
    enabled: true,
    scopeKey: 'global',
    activeTabId: 'thread:b',
    tabs: ['a', 'b'].map(sessionId => ({
      id: `thread:${sessionId}`,
      kind: 'thread',
      sessionId,
      target: { kind: 'thread', sessionId },
      title: sessionId,
      active: sessionId === 'b',
      pinned: false,
      preview: false,
      available: true,
      status: null,
    })),
  }
  semanticDisposers.push(
    connectWorkbenchTabs({
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      renderStart: () => null,
      actions: {
        activate,
        close: vi.fn(),
        keep: vi.fn(),
        togglePin: vi.fn(),
        move: vi.fn(),
        closeOthers: vi.fn(),
        closeToRight: vi.fn(),
        moveAside: () => false,
        open: vi.fn(),
        newTab: vi.fn(),
        renameThread: async () => undefined,
      },
    }),
  )
  const registry = createWorkbenchPanelRegistry()
  for (const id of ['a', 'b']) registry.register({ id, title: id, tabId: `thread:${id}`, component: DraftPanel })
  const rendered = renderWorkbench(registry)
  act(() => {
    rendered.api.addPanel({ id: 'a', title: 'a', component: WORKBENCH_COMPONENT })
    rendered.api.addPanel({ id: 'b', title: 'b', component: WORKBENCH_COMPONENT, position: { referencePanel: 'a', direction: 'right' } })
    for (const panel of [...rendered.api.panels]) if (NewViewTabs.isChooser(panel.id)) panel.api.close()
  })
  return { ...rendered, registry, activate }
}

describe('WorkbenchView', () => {
  it('ignores a real Dockview user-origin focus echo when actual DOM focus remains in an outside Sidebar control', () => {
    const { api, activate } = renderSemanticWorkbench()
    const events: Array<{ panelId: string | undefined; origin: string }> = []
    const subscription = api.onDidActivePanelChange(event => events.push({ panelId: event.panel?.id, origin: event.origin }))
    semanticDisposers.push(() => subscription.dispose())
    act(() => api.getPanel('b')?.api.setActive())
    const sidebar = document.createElement('button')
    document.body.append(sidebar)
    semanticDisposers.push(() => sidebar.remove())
    sidebar.focus()
    activate.mockClear()
    // A stale focus notification can activate a group even though the browser's
    // focused element is still the Sidebar button (the observed route-revert).
    fireEvent.focus(draftOf('a'))
    expect(document.activeElement).toBe(sidebar)
    expect(events).toContainEqual({ panelId: 'a', origin: 'user' })
    expect(activate).not.toHaveBeenCalled()
    sidebar.remove()
  })

  it('repairs same-group presentation to canonical B after rejecting an implicit A activation with outside focus', () => {
    const { api, activate } = renderSemanticWorkbench()
    const a = api.getPanel('a')
    const b = api.getPanel('b')
    if (a === undefined || b === undefined) throw new Error('Missing semantic panels')
    act(() => b.api.moveTo({ group: a.group, position: 'center' }))
    act(() => b.api.setActive())
    const tabA = a.group.element.querySelector('[role="tab"][data-tab-panel-id="a"]')
    if (tabA === null) throw new Error('Missing native A tab')
    const sidebar = document.createElement('button')
    document.body.append(sidebar)
    semanticDisposers.push(() => sidebar.remove())
    sidebar.focus()
    activate.mockClear()
    const observed: Array<{ panelId: string | undefined; activeId: string | undefined; bActive: boolean }> = []
    const subscription = api.onDidActivePanelChange(event =>
      observed.push({ panelId: event.panel?.id, activeId: api.activePanel?.id, bActive: b.api.isActive }),
    )
    semanticDisposers.push(() => subscription.dispose())
    // A native user-origin notification is not sufficient when this group does
    // not actually hold DOM focus. The semantic snapshot still selects B.
    fireEvent.keyDown(tabA, { key: 'Enter' })
    expect(document.activeElement).toBe(sidebar)
    expect(activate).not.toHaveBeenCalled()
    expect(api.activePanel?.id, JSON.stringify(observed)).toBe('b')
    expect(b.api.isVisible).toBe(true)
    expect(a.api.isVisible).toBe(false)
  })

  it('activates the semantic owner on an explicit pointer interaction with its inactive body', () => {
    const { api, activate } = renderSemanticWorkbench()
    act(() => api.getPanel('b')?.api.setActive())
    activate.mockClear()
    fireEvent(draftOf('a'), new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(activate).toHaveBeenCalledWith('thread:a')
  })

  it('hands DOM focus from A to B before body activation and preserves a field already focused inside B', () => {
    const { activate } = renderSemanticWorkbench()
    const a = draftOf('a')
    const b = draftOf('b')
    act(() => a.focus())
    expect(document.activeElement).toBe(a)
    const owners: Array<string | null> = []
    activate.mockImplementation(tabId => {
      if (tabId === 'thread:b') owners.push(document.activeElement?.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id') ?? null)
    })
    activate.mockClear()
    fireEvent(b, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(activate).toHaveBeenCalledWith('thread:b')
    expect(owners.length).toBeGreaterThan(0)
    expect(owners.every(owner => owner === 'b')).toBe(true)
    expect(document.activeElement?.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id')).toBe('b')
    activate.mockClear()
    fireEvent.focus(a)
    expect(activate).not.toHaveBeenCalledWith('thread:a')
    act(() => b.focus())
    fireEvent(b, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(document.activeElement).toBe(b)
  })

  it('focuses the native B tab before its explicit semantic activation while A input previously held focus', () => {
    const { api, activate } = renderSemanticWorkbench()
    act(() => draftOf('a').focus())
    const tab = api.getPanel('b')?.group.element.querySelector<HTMLElement>('[role="tab"][data-tab-panel-id="b"]')
    const label = tab?.querySelector('[data-workbench-tab-id="b"]')
    if (tab === undefined || tab === null || label === null || label === undefined) throw new Error('Missing semantic B header')
    const focused: Array<Element | null> = []
    activate.mockImplementation(tabId => {
      if (tabId === 'thread:b') focused.push(document.activeElement)
    })
    activate.mockClear()
    fireEvent(label, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(activate).toHaveBeenCalledWith('thread:b')
    expect(focused.length).toBeGreaterThan(0)
    expect(focused.every(element => element === tab)).toBe(true)
  })

  it('activates the semantic Start owner on an explicit chooser-body pointer gesture', () => {
    const { api, registry, activate, view } = renderSemanticWorkbench()
    act(() => {
      registry.register({ id: 'semantic-start', title: 'Start', tabId: 'start', newView: true, component: () => null })
      api.addPanel({ id: 'semantic-start', title: 'Start', component: WORKBENCH_COMPONENT })
    })
    const chooser = view.container.querySelector('[data-workbench-panel-id="semantic-start"]')
    if (chooser === null) throw new Error('Missing semantic Start chooser')
    activate.mockClear()
    fireEvent(chooser, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(activate).toHaveBeenCalledExactlyOnceWith('start')
  })

  it('admits real keyboard selection from the native tablist in the target group', () => {
    const { api, activate } = renderSemanticWorkbench()
    const a = api.getPanel('a')
    const b = api.getPanel('b')
    if (a === undefined || b === undefined) throw new Error('Missing semantic panels')
    act(() => b.api.moveTo({ group: a.group, position: 'center' }))
    const tabA = a.group.element.querySelector<HTMLElement>('[role="tab"][data-tab-panel-id="a"]')
    const tabB = a.group.element.querySelector<HTMLElement>('[role="tab"][data-tab-panel-id="b"]')
    if (tabA === null || tabB === null) throw new Error('Missing native tablist')
    act(() => a.api.setActive())
    tabB.focus()
    activate.mockClear()
    fireEvent.keyDown(tabB, { key: 'Enter' })
    expect(activate).toHaveBeenCalledWith('thread:b')
  })

  it('preserves an intentional single-tab hidden centre, offers recovery and keeps the last grid unclosable', async () => {
    const storage = memoryStorage()
    const legacy = createDockview(document.createElement('div'), {
      createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
    })
    legacy.layout(900, 600)
    const panel = legacy.addPanel({ id: 'a', title: 'A', component: WORKBENCH_COMPONENT })
    panel.group.header.hidden = true
    createLayoutStore({ storage }).set(legacy.toJSON())
    legacy.dispose()
    const restored = renderWorkbench(registryWith('a'), storage, 'main')
    await flushLayoutChange()
    expect(restored.api.getPanel('a')?.group.header.hidden).toBe(true)
    const original = draftOf('a')
    fireEvent.change(original, { target: { value: 'same hidden view' } })
    fireEvent.click(restored.view.getByRole('button', { name: 'Show tab row' }))
    expect(restored.api.getPanel('a')?.group.header.hidden).toBe(false)
    expect(draftOf('a')).toBe(original)
    expect(original.value).toBe('same hidden view')
    expect(restored.api.getPanel('a')?.group.element.querySelector('button[aria-label="New tab"]')).not.toBeNull()
    expect(restored.api.getPanel('a')?.group.element.querySelector('button[aria-label="Close pane"]')).toBeNull()
    act(() => restored.api.getPanel('a')?.api.close())
    await flushLayoutChange()
    expect(restored.api.groups.some(group => group.api.location.type === 'grid' && group.panels.length > 0 && !group.header.hidden)).toBe(true)
  })

  it('offers the single-tab action on blank row space without intercepting content context menus', async () => {
    const { api } = renderWorkbench(registryWith('a'), memoryStorage(), 'main')
    const panel = api.getPanel('a')
    if (panel === undefined) throw new Error('Missing row context target')
    const input = draftOf('a')
    fireEvent.change(input, { target: { value: 'content context belongs to editor' } })
    expect(fireEvent.contextMenu(input, { clientX: 20, clientY: 80 })).toBe(true)
    expect(screen.queryByRole('menuitem', { name: 'Hide tab row' })).toBeNull()
    const blank = panel.group.element.querySelector('.dv-void-container')
    if (blank === null) throw new Error('Native blank tab row missing')
    fireEvent.contextMenu(blank, { clientX: 40, clientY: 12 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide tab row' }))
    expect(panel.group.header.hidden).toBe(true)
    expect(draftOf('a')).toBe(input)
    fireEvent.click(screen.getByRole('button', { name: 'Show tab row' }))
    expect(panel.group.header.hidden).toBe(false)
    expect(input.value).toBe('content context belongs to editor')
  })

  it('keeps a populated centre grid when its last panel floats without remounting its draft', async () => {
    const { api } = renderWorkbench(registryWith('a'), memoryStorage(), 'main')
    const panel = api.getPanel('a')
    if (panel === undefined) throw new Error('Missing initial centre panel')
    const input = draftOf('a')
    fireEvent.change(input, { target: { value: 'keep floated draft' } })
    const mounted = mounts.get('a')
    act(() => api.addFloatingGroup(panel))
    await flushLayoutChange()
    const grid = api.groups.filter(group => group.api.location.type === 'grid')
    expect(grid.some(group => group.panels.length > 0 && !group.header.hidden)).toBe(true)
    expect(panel.group.api.location.type).toBe('floating')
    expect(api.activePanel?.id).toBe('a')
    expect(draftOf('a')).toBe(input)
    expect(input.value).toBe('keep floated draft')
    expect(mounts.get('a')).toBe(mounted)
  })

  it('cannot close the last centre grid into a floating neighbor', async () => {
    const { api } = renderWorkbench(registryWith('a', 'b'), memoryStorage(), 'main')
    const first = api.getPanel('a')
    const floating = api.getPanel('b')
    if (first === undefined || floating === undefined) throw new Error('Missing initial split panels')
    act(() => api.addFloatingGroup(floating))
    await flushLayoutChange()
    const close = first.group.element.querySelector('button[aria-label="Close pane"]')
    if (close !== null) fireEvent.click(close)
    await flushLayoutChange()
    expect(first.group.api.location.type).toBe('grid')
    expect(first.group.element.querySelector('button[aria-label="Close pane"]')).toBeNull()
    expect(floating.group.api.location.type).toBe('floating')
  })

  it('repairs a floating-only persisted centre and unhides its docked tab strip', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a'), storage, 'main')
    const panel = first.api.getPanel('a')
    if (panel === undefined) throw new Error('Missing initial panel')
    act(() => first.api.addFloatingGroup(panel))
    // Store the genuine old broken state, independently of runtime repair.
    const saved = first.api.toJSON()
    saved.grid.root = { type: 'branch', data: [] }
    first.store.set(saved)
    first.view.unmount()
    const restored = renderWorkbench(registryWith('a'), storage, 'main')
    await flushLayoutChange()
    const grid = restored.api.groups.find(group => group.api.location.type === 'grid' && group.panels.length > 0)
    expect(grid).toBeDefined()
    expect(grid?.header.hidden).toBe(false)
    expect(restored.api.getPanel('a')?.group.api.location.type).toBe('floating')
  })

  it('refreshes restored reusable view names without changing identity or remounting state', async () => {
    const storage = memoryStorage()
    const registry = createWorkbenchPanelRegistry()
    const id = 'legacy.status-view'
    registry.register({ id, title: 'Sidebar status', component: DraftPanel })
    const first = renderWorkbench(registry, storage)
    expect(first.api.getPanel(id)?.title).toBe('Sidebar status')
    await flushLayoutChange()
    first.view.unmount()
    registry.register({ id, title: 'AI Accounts: Preview', component: DraftPanel })
    const restored = renderWorkbench(registry, storage)
    expect(restored.api.getPanel(id)?.title).toBe('AI Accounts: Preview')
    expect(screen.getByRole('tab', { name: 'AI Accounts: Preview' })).toBeDefined()
    const input = draftOf(id)
    fireEvent.change(input, { target: { value: 'keep this view state' } })
    const mountCount = mounts.get(id)
    act(() => {
      registry.register({ id, title: 'AI Accounts: 预览', component: DraftPanel })
    })
    expect(restored.api.getPanel(id)?.title).toBe('AI Accounts: 预览')
    expect(draftOf(id)).toBe(input)
    expect(draftOf(id).value).toBe('keep this view state')
    expect(mounts.get(id)).toBe(mountCount)
    await flushLayoutChange()
    expect(restored.store.get()?.panels[id]?.title).toBe('AI Accounts: 预览')
  })

  it('reports a hidden retained surface to its real panel without losing state or remounting', () => {
    const visibility: boolean[] = []
    const registry = createWorkbenchPanelRegistry()
    const Probe = (props: WorkbenchPanelProps): JSX.Element => {
      visibility.push(props.visible ?? true)
      return <DraftPanel {...props} />
    }
    registry.register({ id: 'retained', title: 'Retained', component: Probe })
    const store = createLayoutStore({ storage: memoryStorage() })
    const view = render(<WorkbenchView registry={registry} store={store} t={t} visible />)
    const draft = draftOf('retained')
    fireEvent.change(draft, { target: { value: 'keep this live draft' } })
    const before = mounts.get('retained')
    view.rerender(<WorkbenchView registry={registry} store={store} t={t} visible={false} />)
    expect(visibility.at(-1)).toBe(false)
    expect(draftOf('retained')).toBe(draft)
    view.rerender(<WorkbenchView registry={registry} store={store} t={t} visible />)
    expect(visibility.at(-1)).toBe(true)
    expect(draftOf('retained').value).toBe('keep this live draft')
    expect(mounts.get('retained')).toBe(before)
  })

  it('places the plus immediately after tabs before the flexible row spacer', () => {
    const { view } = renderWorkbench(registryWith('a', 'b'))
    const rows = [...view.container.querySelectorAll('.dv-tabs-and-actions-container')]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const tabs = row.querySelector('.dv-scrollable')
      const actions = row.querySelector('.dv-left-actions-container')
      expect(tabs?.nextElementSibling).toBe(actions)
      expect(actions?.querySelector('button[aria-label="New tab"]')).not.toBeNull()
      expect(actions?.nextElementSibling?.classList.contains('dv-void-container')).toBe(true)
      expect(row.querySelector('.dv-right-actions-container button[aria-label="New tab"]')).toBeNull()
    }
  })

  it('keeps a plus picker in every split tab strip and adds to that group', () => {
    const { api, view } = renderWorkbench(registryWith('a', 'b', 'c'))
    act(() => api.getPanel('c')?.api.close())
    const groups = [...view.container.querySelectorAll('.dv-tabs-and-actions-container')]
    expect(groups).toHaveLength(2)
    for (const group of groups) expect(group.querySelector('button[aria-label="New tab"]')).not.toBeNull()
    const target = api.getPanel('b')?.group
    const plus = groups[1]?.querySelector('button[aria-label="New tab"]')
    if (target === undefined || plus === null || plus === undefined) throw new Error('Missing split group picker')
    fireEvent.click(plus)
    const chooser = api.activePanel
    expect(chooser?.api.title).toBe('New tab')
    expect(chooser?.group).toBe(target)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByText('c', { selector: 'button span' }))
    expect(api.panels.some(panel => NewViewTabs.isChooser(panel.id))).toBe(false)
    expect(api.getPanel('c')?.group).toBe(target)
  })

  it('offers an already-open reusable view and moves it into the chosen group without remounting', () => {
    mounts.clear()
    const { api, view } = renderWorkbench(registryWith('a', 'b'))
    const target = api.getPanel('b')?.group
    const plus = view.container.querySelectorAll('.dv-tabs-and-actions-container button[aria-label="New tab"]')[1]
    if (target === undefined || plus === undefined) throw new Error('Missing target group')
    fireEvent.change(draftOf('a'), { target: { value: 'keep me' } })
    fireEvent.click(plus)
    fireEvent.click(screen.getByText('a', { selector: 'button span' }))
    expect(api.getPanel('a')?.group).toBe(target)
    expect(draftOf('a').value).toBe('keep me')
    expect(mounts.get('a')).toBe(1)
  })

  it('keeps runtime occurrences out of view pickers and empty-state preferences', () => {
    const registry = registryWith('plugin-view')
    registry.register({ id: 'runtime-trajectory', title: 'Trajectory — A', component: DraftPanel, hiddenFromAdd: true, showInEmptyState: true })
    const { view } = renderWorkbench(registry, memoryStorage(), 'bottom')
    expect(screen.queryByRole('checkbox', { name: /Trajectory/ })).toBeNull()
    expect(view.queryByRole('button', { name: 'Trajectory — A', hidden: true })).toBeNull()
    expect(screen.getByText('plugin-view', { selector: 'button span' })).toBeDefined()
  })

  it('routes empty-pane view choices through that pane rather than the global main router', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'plugin-view', title: 'Plugin view', component: DraftPanel, showInEmptyState: true })
    const open = vi.fn()
    render(
      <WorkbenchView registry={registry} store={createLayoutStore({ storage: memoryStorage() })} t={t} region="bottom" surface="bottom" onOpenPanel={open} />,
    )
    fireEvent.click(screen.getByText('Plugin view', { selector: 'button span' }))
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0]?.[0]?.id).toBe('plugin-view')
    expect(registry.hasOpenRequests()).toBe(false)
  })

  it('closes the right pane after its last tab is removed without creating a chooser', async () => {
    const { api, store, onClose } = renderRightWorkbench('a')
    expect(onClose).not.toHaveBeenCalled()
    act(() => api.getPanel('a')?.api.close())
    await flushLayoutChange()
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.panels).toHaveLength(0)
    expect(screen.queryByLabelText('Choose a view')).toBeNull()
    expect(Object.keys(store.get()?.panels ?? {})).toEqual([])
  })

  it('keeps the right pane open after a partial close and closes its final chooser too', async () => {
    const { api, onClose } = renderRightWorkbench('a', 'b')
    act(() => api.getPanel('a')?.api.close())
    await flushLayoutChange()
    expect(api.panels.map(panel => panel.id)).toEqual(['b'])
    expect(onClose).not.toHaveBeenCalled()
    act(() => NewViewTabs.open(api))
    act(() => api.getPanel('b')?.api.close())
    await flushLayoutChange()
    expect(onClose).not.toHaveBeenCalled()
    act(() => api.activePanel?.api.close())
    await flushLayoutChange()
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.panels).toHaveLength(0)
  })

  it('does not close the right pane at a native intra-API move transient zero', async () => {
    const { api, onClose } = renderRightWorkbench('a')
    const panel = api.getPanel('a')
    if (panel === undefined) throw new Error('Missing right panel')
    let target = panel.group
    act(() => {
      target = api.addGroup({ referenceGroup: panel.group, direction: 'right' })
    })
    const counts: number[] = []
    const removed = panel.group.model.onDidRemovePanel(() => counts.push(api.panels.length))
    const apiRemoved = vi.fn()
    const removal = api.onDidRemovePanel(apiRemoved)
    act(() => panel.api.moveTo({ group: target, position: 'center' }))
    await flushLayoutChange()
    expect(counts).toContain(0)
    expect(apiRemoved).not.toHaveBeenCalled()
    expect(api.panels.map(candidate => candidate.id)).toEqual(['a'])
    expect(onClose).not.toHaveBeenCalled()
    removed.dispose()
    removal.dispose()
    act(() => panel.api.close())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the right pane and its draft when its last grid panel floats, then closes on final float removal', async () => {
    const { api, onClose } = renderRightWorkbench('a')
    const panel = api.getPanel('a')
    if (panel === undefined) throw new Error('Missing right panel')
    const draft = draftOf('a')
    fireEvent.change(draft, { target: { value: 'floating right draft' } })
    const before = mounts.get('a')
    act(() => api.addFloatingGroup(panel))
    await flushLayoutChange()
    expect(api.groups.filter(group => group.api.location.type === 'grid')).toHaveLength(0)
    expect(api.panels.map(candidate => candidate.id)).toEqual(['a'])
    expect(panel.group.api.location.type).toBe('floating')
    expect(onClose).not.toHaveBeenCalled()
    expect(draftOf('a')).toBe(draft)
    expect(draft.value).toBe('floating right draft')
    expect(mounts.get('a')).toBe(before)
    act(() => panel.api.close())
    await flushLayoutChange()
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.panels).toHaveLength(0)
  })

  it('merges a right split without closing the pane or its resources', async () => {
    const { api, onClose } = renderRightWorkbench('a', 'b')
    const a = api.getPanel('a')
    const b = api.getPanel('b')
    if (a === undefined || b === undefined) throw new Error('Missing right panels')
    act(() => b.api.moveTo({ group: a.group, position: 'right' }))
    await flushLayoutChange()
    const close = b.group.element.querySelector('button[aria-label="Close pane"]')
    if (close === null) throw new Error('Missing right split close')
    fireEvent.click(close)
    await flushLayoutChange()
    expect(api.groups).toHaveLength(1)
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b'])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not auto-close initial empty right restoration or empty native load and clear', async () => {
    const { api, onClose, store } = renderRightWorkbench()
    await flushLayoutChange()
    expect(onClose).not.toHaveBeenCalled()
    expect(api.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(api.panels[0]!.id)).toBe(true)
    const populated = api.toJSON()
    act(() => api.clear())
    expect(onClose).not.toHaveBeenCalled()
    const empty = api.toJSON()
    act(() => api.fromJSON(populated))
    act(() => api.fromJSON(empty))
    await flushLayoutChange()
    expect(onClose).not.toHaveBeenCalled()
    expect(api.panels).toHaveLength(0)
    expect(Object.keys(store.get()?.panels ?? {})).toEqual([])
  })

  it('reopens an auto-closed empty right pane with one chooser using the same API without reset or handoff replay', async () => {
    const { api, onClose, onApi, setVisible, view } = renderRightWorkbench('a')
    const native = view.container.querySelector('.dv-dockview')
    act(() => api.getPanel('a')?.api.close())
    expect(onClose).toHaveBeenCalledOnce()
    setVisible(false)
    await flushLayoutChange()
    expect(api.panels).toHaveLength(0)
    expect(workbenchRegions().get('right')).toBe(api)
    expect(view.container.querySelector('.dv-dockview')).toBe(native)
    setVisible(true)
    expect(api.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(api.panels[0]!.id)).toBe(true)
    await flushLayoutChange()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onApi).toHaveBeenCalledOnce()
    expect(view.container.querySelector('.dv-dockview')).toBe(native)
  })

  it('reveals an explicitly adopted right resource without adding a phantom chooser or replaying the handoff', async () => {
    const { api, registry, onApi, onClose, setVisible } = renderRightWorkbench('a')
    act(() => api.getPanel('a')?.api.close())
    setVisible(false)
    await flushLayoutChange()
    const resourceClose = vi.fn()
    act(() => {
      registry.register({ id: 'resource', title: 'Resource', component: DraftPanel, hiddenFromAdd: true, beforeClose: resourceClose })
      api.addPanel({ id: 'resource', title: 'Resource', component: WORKBENCH_COMPONENT })
    })
    const draft = draftOf('resource')
    fireEvent.change(draft, { target: { value: 'adopted while retained' } })
    const before = mounts.get('resource')
    setVisible(true)
    await flushLayoutChange()
    expect(api.panels.map(panel => panel.id)).toEqual(['resource'])
    expect(screen.queryByLabelText('Choose a view')).toBeNull()
    expect(resourceClose).not.toHaveBeenCalled()
    expect(onApi).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(draftOf('resource')).toBe(draft)
    expect(draft.value).toBe('adopted while retained')
    expect(mounts.get('resource')).toBe(before)
  })

  it('retains bottom and left final-tab chooser semantics without closing their parents', async () => {
    for (const region of ['left', 'bottom'] as const) {
      const onClose = vi.fn()
      const registry = registryWith('a')
      const store = createLayoutStore({ storage: memoryStorage() })
      let api: DockviewApi | undefined
      const view = render(
        <WorkbenchView
          registry={registry}
          store={store}
          t={t}
          region={region}
          surface="bottom"
          onClose={onClose}
          onApi={ready => {
            api = ready
          }}
        />,
      )
      if (api === undefined) throw new Error('Legacy region did not become ready')
      act(() => api?.activePanel?.api.close())
      await flushLayoutChange()
      expect(onClose).not.toHaveBeenCalled()
      expect(api.panels).toHaveLength(1)
      expect(NewViewTabs.isChooser(api.panels[0]!.id)).toBe(true)
      view.unmount()
    }
  })

  it('keeps an add-view control reachable when the last tab is closed', async () => {
    const { api } = renderWorkbench(registryWith('a'))
    act(() => api.getPanel('a')?.api.close())
    await flushLayoutChange()
    expect(screen.getByRole('button', { name: 'New tab' })).toBeDefined()
    expect(api.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(api.panels[0]!.id)).toBe(true)
  })

  it('replaces a final closed chooser with a fresh persisted chooser', async () => {
    const { api, store } = renderWorkbench(registryWith('a'), memoryStorage(), 'bottom')
    const previous = api.activePanel?.id
    act(() => api.activePanel?.api.close())
    await flushLayoutChange()
    expect(api.panels).toHaveLength(1)
    expect(api.activePanel?.id).not.toBe(previous)
    expect(NewViewTabs.isChooser(api.activePanel!.id)).toBe(true)
    await flushLayoutChange()
    expect(Object.keys(store.get()?.panels ?? {})).toEqual([api.activePanel?.id])
  })

  it('drains standalone queued requests before adding an empty-pane chooser', () => {
    const registry = registryWith('queued')
    registry.open('queued')
    const { api } = renderWorkbench(registry, memoryStorage(), 'bottom')
    expect(api.panels.map(panel => panel.id)).toEqual(['queued'])
    expect(screen.queryByLabelText('Choose a view')).toBeNull()
  })

  it('delegates coordinated reset instead of recreating only a local default', async () => {
    const reset = vi.fn()
    const registry = registryWith('a')
    let api: DockviewApi | undefined
    render(
      <WorkbenchView
        registry={registry}
        store={createLayoutStore({ storage: memoryStorage() })}
        t={t}
        onResetLayout={reset}
        onApi={ready => {
          api = ready
        }}
      />,
    )
    act(() => api?.getPanel('a')?.api.close())
    await flushLayoutChange()
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Pane options' })[0]!, { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'resetLayout' }))
    expect(reset).toHaveBeenCalledOnce()
    expect(api?.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(api!.panels[0]!.id)).toBe(true)
  })

  it('reports ready only after the API is registered and does not replay an inline callback', () => {
    const registry = registryWith('a')
    const store = createLayoutStore({ storage: memoryStorage() })
    const ready = vi.fn((api: DockviewApi) => expect(workbenchRegions().get('main')).toBe(api))
    const view = render(<WorkbenchView registry={registry} store={store} t={t} region="main" onApi={api => ready(api)} />)
    expect(ready).toHaveBeenCalledOnce()
    view.rerender(<WorkbenchView registry={registry} store={store} t={t} region="main" onApi={api => ready(api)} />)
    expect(ready).toHaveBeenCalledOnce()
    view.unmount()
    expect(workbenchRegions().get('main')).toBeUndefined()
  })

  it('persists queued panels adopted at API handoff without depending on later Dockview layout events', () => {
    const registry = registryWith('queued-thread')
    const store = createLayoutStore({ surface: 'dock', storage: memoryStorage() })
    const view = render(
      <WorkbenchView
        registry={registry}
        store={store}
        t={t}
        region="right"
        surface="dock"
        defaultLayout="empty"
        onApi={api => {
          api.addPanel({ id: 'queued-thread', title: 'Queued thread', component: WORKBENCH_COMPONENT })
        }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Queued thread' })).toBeDefined()
    expect(store.get()?.panels['queued-thread']).toMatchObject({ id: 'queued-thread' })
    view.unmount()
    render(<WorkbenchView registry={registry} store={store} t={t} region="right" surface="dock" defaultLayout="empty" />)
    expect(screen.getByRole('tab', { name: 'Queued thread' })).toBeDefined()
  })

  it('restores chooser identities without a missing-plugin placeholder or redundant tab', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a'), storage, 'bottom')
    const id = first.api.activePanel?.id
    await flushLayoutChange()
    first.view.unmount()
    const second = renderWorkbench(registryWith('a'), storage, 'bottom')
    expect(second.api.panels.map(panel => panel.id)).toEqual([id])
    expect(screen.queryByText(/missingPanel/)).toBeNull()
    expect(screen.getByLabelText('Choose a view')).toBeDefined()
  })

  it('opens repeated plugin view occurrences and restores their source identity', async () => {
    const registry = registryWith('a')
    registry.register({ id: 'repeatable-view', title: 'Repeatable view', component: DraftPanel, allowMultiple: true })
    const storage = memoryStorage()
    const first = renderWorkbench(registry, storage, 'bottom')
    fireEvent.click(screen.getByText('Repeatable view', { selector: 'button span' }))
    const one = first.api.activePanel
    act(() => {
      NewViewTabs.open(first.api, one?.group)
    })
    fireEvent.click(screen.getByText('Repeatable view', { selector: 'button span' }))
    expect(first.api.panels).toHaveLength(2)
    expect(first.api.panels.every(panel => panel.toJSON().params?.sourceId === 'repeatable-view')).toBe(true)
    expect(first.api.activePanel).not.toBe(one)
    await flushLayoutChange()
    first.view.unmount()
    const restored = renderWorkbench(registry, storage, 'bottom')
    expect(restored.api.panels).toHaveLength(2)
    expect(screen.queryByText(/missingPanel/)).toBeNull()
    for (const panel of restored.api.panels) expect(draftOf(panel.id)).toBeTruthy()
  })

  it('replaces a semantic start chooser and closes only that semantic actor', () => {
    const registry = registryWith('view')
    const closeStart = vi.fn()
    const closeResource = vi.fn()
    registry.register({ id: 'start', title: 'New tab', component: () => null, hiddenFromAdd: true, newView: true, beforeClose: closeStart })
    registry.register({ id: 'resource', title: 'Resource', component: DraftPanel, hiddenFromAdd: true, beforeClose: closeResource })
    const { api } = renderWorkbench(registry)
    act(() => {
      api.addPanel({ id: 'start', component: WORKBENCH_COMPONENT, title: 'New tab' })
    })
    fireEvent.click(screen.getByText('view', { selector: 'button span' }))
    expect(api.getPanel('start')).toBeUndefined()
    expect(closeStart).toHaveBeenCalledOnce()
    expect(closeResource).not.toHaveBeenCalled()
  })

  it('keeps pane controls inside compact group chrome and splits into a chooser', () => {
    const close = vi.fn()
    const registry = registryWith('a')
    const { container } = render(<WorkbenchView registry={registry} store={createLayoutStore({ storage: memoryStorage() })} t={t} onClose={close} />)
    expect(container.querySelector('header')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'title' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pane options' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split right' }))
    expect(screen.getAllByRole('button', { name: 'New tab' })).toHaveLength(2)
    expect(screen.getByLabelText('Choose a view')).toBeDefined()
    const actions = container.querySelectorAll('.dv-right-actions-container')
    expect(actions).toHaveLength(2)
    expect(within(actions[0] as HTMLElement).getByRole('button', { name: 'Close pane' })).toBeDefined()
  })

  it('closes a split by merging tabs without closing resources or losing their drafts', async () => {
    mounts.clear()
    const registry = registryWith('a')
    const closeResource = vi.fn()
    registry.register({ id: 'resource', title: 'Resource', component: DraftPanel, beforeClose: closeResource })
    const { api, view } = renderWorkbench(registry)
    fireEvent.change(draftOf('resource'), { target: { value: 'retained resource draft' } })
    await flushLayoutChange()
    const close = view.container.querySelectorAll('.dv-right-actions-container button[aria-label="Close pane"]')[1]
    if (close === undefined) throw new Error('Missing split close control')
    fireEvent.click(close)
    expect(api.groups).toHaveLength(1)
    expect(api.getPanel('resource')).toBeDefined()
    expect(closeResource).not.toHaveBeenCalled()
    expect(draftOf('resource').value).toBe('retained resource draft')
    expect(mounts.get('resource')).toBe(1)
  })

  it('contains its own internal drag so an outer surface cannot adopt it', () => {
    const parentOver = vi.fn()
    const parentDrop = vi.fn()
    let api: DockviewApi | undefined
    const registry = registryWith('a')
    const store = createLayoutStore({ storage: memoryStorage() })
    const view = render(
      <div onDragOver={parentOver} onDrop={parentDrop}>
        <WorkbenchView
          registry={registry}
          store={store}
          t={t}
          onApi={ready => {
            api = ready
          }}
        />
      </div>,
    )
    const element = view.container.querySelector('.dv-dockview')
    const outer = view.container.firstElementChild
    if (api === undefined || element === null || outer === null) throw new Error('Dockview did not mount')
    // Dockview uses native listeners: a React-only fence runs after the containing Dockview already saw the event.
    outer.addEventListener('dragover', parentOver)
    outer.addEventListener('drop', parentDrop)
    dragPayloadOf(new PanelTransfer(api.id, api.groups[0]?.id ?? '', 'a'), () => {
      fireEvent.dragEnter(element)
      fireEvent.dragOver(element)
      fireEvent.drop(element)
    })
    expect(parentOver).not.toHaveBeenCalled()
    expect(parentDrop).not.toHaveBeenCalled()
    expect(api.getPanel('a')).toBeDefined()
  })

  it('lets the deepest surface split an internal drag before an outer capture target can claim its overlay', () => {
    let outerApi: DockviewApi | undefined
    let innerApi: DockviewApi | undefined
    const innerRegistry = registryWith('a', 'b')
    const innerStore = createLayoutStore({ storage: memoryStorage() })
    const registry = createWorkbenchPanelRegistry()
    registry.register({
      id: 'nested',
      title: 'Nested',
      component: () => (
        <WorkbenchView
          registry={innerRegistry}
          store={innerStore}
          t={t}
          region="nested/main/test"
          onApi={ready => {
            innerApi = ready
          }}
        />
      ),
    })
    const outerDrop = vi.fn()
    const view = render(
      <WorkbenchView
        registry={registry}
        store={createLayoutStore({ storage: memoryStorage() })}
        t={t}
        region="main"
        onApi={ready => {
          outerApi = ready
        }}
        acceptDroppedPanel={event => event.accept()}
        onDropPanel={outerDrop}
      />,
    )
    if (outerApi === undefined || innerApi === undefined) throw new Error('Nested Dockviews did not mount')
    const panel = innerApi.getPanel('b')
    const group = innerApi.getPanel('a')?.group
    if (panel === undefined || group === undefined) throw new Error('Nested panels did not mount')
    act(() => panel.api.moveTo({ group, position: 'center' }))
    expect(innerApi.groups).toHaveLength(1)
    // jsdom has no layout. Supply content geometry but use real Dockview overlay/capture/drop listeners.
    for (const container of view.container.querySelectorAll('.dv-content-container')) {
      Object.defineProperties(container, { offsetWidth: { value: 600 }, offsetHeight: { value: 400 } })
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 600, 400))
    }
    const target = draftOf('b')
    const nestedOverlay = vi.fn()
    const overlay = innerApi.onWillShowOverlay(nestedOverlay)
    dragPayloadOf(new PanelTransfer(innerApi.id, group.id, 'b'), () => {
      fireEvent.dragEnter(target, { clientX: 570, clientY: 300 })
      fireEvent.dragOver(target, { clientX: 570, clientY: 300 })
      fireEvent.drop(target, { clientX: 570, clientY: 300 })
    })
    expect(nestedOverlay).toHaveBeenCalled()
    expect(innerApi.groups).toHaveLength(2)
    expect(outerApi.panels.map(panel => panel.id)).toEqual(['nested'])
    expect(outerDrop).not.toHaveBeenCalled()
    overlay.dispose()
  })

  it('refuses an ancestor drop through the foreign fallback and never bubbles it to a parent target', () => {
    const outer = nestedSurfacePath('main', 'outer-test')
    const inner = nestedSurfacePath(outer, 'inner-test')
    const id = nestedPanelId(outer)
    const parentDrop = vi.fn()
    const dropped = vi.fn()
    const registry = registryWith(id)
    const store = createLayoutStore({ storage: memoryStorage() })
    const view = render(
      <div onDrop={parentDrop}>
        <WorkbenchView
          registry={registry}
          store={store}
          t={t}
          surface={inner}
          region={inner}
          acceptPanel={panelId => canMovePanelToRegion(panelId, inner)}
          onDropPanel={dropped}
        />
      </div>,
    )
    const element = view.container.querySelector('.dv-dockview')
    if (element === null) throw new Error('Dockview did not mount')
    dragPayloadOf(new PanelTransfer('foreign-api', 'foreign-group', id), () => {
      fireEvent.dragEnter(element)
      fireEvent.dragOver(element)
      fireEvent.drop(element)
    })
    expect(dropped).not.toHaveBeenCalled()
    expect(parentDrop).not.toHaveBeenCalled()
    expect(view.container.querySelector('.dshx\\:ring-2')).toBeNull()
  })

  it('stops accepted foreign drops at the owning surface', () => {
    const parentDrop = vi.fn()
    const dropped = vi.fn()
    const registry = registryWith('a')
    const store = createLayoutStore({ storage: memoryStorage() })
    const view = render(
      <div onDrop={parentDrop}>
        <WorkbenchView registry={registry} store={store} t={t} surface="bottom" acceptPanel={() => true} onDropPanel={dropped} />
      </div>,
    )
    const element = view.container.querySelector('.dv-dockview')
    if (element === null) throw new Error('Dockview did not mount')
    dragPayloadOf(new PanelTransfer('foreign-api', 'foreign-group', 'a'), () => fireEvent.drop(element))
    expect(dropped).toHaveBeenCalledOnce()
    expect(parentDrop).not.toHaveBeenCalled()
  })

  it('shows curated views without watermark preference controls and searches plugin names', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'backlog', title: 'Backlog', component: DraftPanel })
    registry.register({ id: 'other', title: 'Other', component: DraftPanel })
    renderWorkbench(registry, memoryStorage(), 'bottom')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Backlog', { selector: 'button span' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search views'), { target: { value: 'other' } })
    expect(screen.queryByText('Backlog', { selector: 'button span' })).toBeNull()
    expect(screen.getByText('Other', { selector: 'button span' })).toBeTruthy()
  })

  it('opens the first two registered panels side by side by default', () => {
    const { api } = renderWorkbench(registryWith('a', 'b', 'c'))
    expect(api.groups).toHaveLength(2)
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b', 'c'])
    expect(api.getPanel('c')?.group).toBe(api.getPanel('a')?.group)
  })

  it('opens the Editor alone by default and leaves the other panels to Add panel', () => {
    const { api } = renderWorkbench(registryWith('other-plugin.panel', 'dshfiles-editor.main', 'other'))
    expect(api.panels.map(panel => panel.id)).toEqual(['dshfiles-editor.main'])
    expect(api.getPanel('dshfiles-editor.main')?.api.isActive).toBe(true)
  })

  it('opens new right and bottom panes with chooser tabs while retaining the main default', () => {
    const dock = renderWorkbench(mixedRegistry(), memoryStorage(), 'dock')
    expect(dock.api.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(dock.api.panels[0]!.id)).toBe(true)
    dock.view.unmount()

    // The dock already shows that panel, and a panel lives in exactly one
    // region: the row waits for one to be dragged or moved into it.
    const bottom = renderWorkbench(mixedRegistry(), memoryStorage(), 'bottom')
    expect(bottom.api.panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(bottom.api.panels[0]!.id)).toBe(true)
    bottom.view.unmount()

    const main = renderWorkbench(mixedRegistry())
    expect(main.api.panels.map(panel => panel.id)).toEqual(['dshfiles-editor.main'])
  })

  it('takes a panel dragged in from another region, even over a surface that shows none', () => {
    const { dropped, element } = renderDropZone(registryWith('a'), 'bottom')
    dragPayloadOf(new PanelTransfer('another-surface', 'another-group', 'a'), () => {
      fireEvent.dragOver(element)
      fireEvent.drop(element)
    })

    expect(dropped).toHaveBeenCalledTimes(1)
    expect(dropped.mock.calls[0]?.[0]).toMatchObject({ panelId: 'a' })
  })

  it('leaves a drag started on its own surface to Dockview', () => {
    const { api, dropped, element } = renderDropZone(registryWith('a'), 'main')
    dragPayloadOf(new PanelTransfer(api.id, 'own-group', 'a'), () => {
      fireEvent.dragOver(element)
      fireEvent.drop(element)
    })

    expect(dropped).not.toHaveBeenCalled()
  })

  it('saves the layout it applied, so a reload restores the surface instead of rebuilding its default', () => {
    const { store, view } = renderWorkbench(mixedRegistry(), memoryStorage(), 'dock')
    const panels = Object.keys(store.get()?.panels ?? {})
    expect(panels).toHaveLength(1)
    expect(NewViewTabs.isChooser(panels[0]!)).toBe(true)
    view.unmount()
  })

  it('keeps a panel mounted with its draft while it is tabbed, split, floated and moved back', () => {
    mounts.clear()
    const { api } = renderWorkbench(registryWith('a', 'b'))
    fireEvent.change(draftOf('a'), { target: { value: 'unsaved draft' } })
    const panel = api.getPanel('a')
    const target = api.getPanel('b')?.group
    if (panel === undefined || target === undefined) throw new Error('default layout is missing a panel')

    act(() => panel.api.moveTo({ group: target, position: 'center' }))
    expect(api.groups).toHaveLength(1)
    act(() => panel.api.moveTo({ group: target, position: 'left' }))
    expect(api.groups).toHaveLength(2)
    act(() => api.addFloatingGroup(panel))
    expect(panel.group.api.location.type).toBe('floating')
    act(() => panel.api.moveTo({ group: target, position: 'center' }))
    expect(panel.group).toBe(target)

    expect(mounts.get('a')).toBe(1)
    expect(draftOf('a').value).toBe('unsaved draft')
  })

  it('restores the saved layout after a reload', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a', 'b'), storage)
    const b = first.api.getPanel('b')
    const target = first.api.getPanel('a')?.group
    if (b === undefined || target === undefined) throw new Error('default layout is missing a panel')
    act(() => b.api.moveTo({ group: target, position: 'center' }))
    expect(first.api.groups).toHaveLength(1)
    expect(first.api.activePanel?.id).toBe('b')
    await flushLayoutChange()
    first.view.unmount()

    const second = renderWorkbench(registryWith('a', 'b'), storage)
    expect(second.api.groups).toHaveLength(1)
    expect(second.api.activePanel?.id).toBe('b')
    expect(second.api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b'])
  })

  it('resets to the default layout and saves it', async () => {
    const { api, store } = renderWorkbench(registryWith('a', 'b'))
    const b = api.getPanel('b')
    if (b === undefined) throw new Error('default layout is missing b')
    act(() => b.api.close())
    expect(api.panels).toHaveLength(1)

    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Pane options' })[0]!, { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'resetLayout' }))
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b'])
    await flushLayoutChange()
    expect(Object.keys(store.get()?.panels ?? {}).sort()).toEqual(['a', 'b'])
  })

  it('keeps a saved panel whose plugin is gone as a closable placeholder that recovers on registration', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a', 'gone'), storage)
    act(() => first.api.getPanel('gone')?.api.setActive())
    await flushLayoutChange()
    first.view.unmount()

    const registry = registryWith('a')
    const { api } = renderWorkbench(registry, storage)
    expect(screen.getByText('missingPanel:{"id":"gone"}')).toBeTruthy()

    act(() => void registry.register({ id: 'gone', title: 'gone', component: DraftPanel }))
    expect(screen.queryByText('missingPanel:{"id":"gone"}')).toBeNull()
    expect(draftOf('gone')).toBeTruthy()

    act(() => void registry.register({ id: 'gone', title: 'gone', component: () => null })())
    // Dockview's render overlay has no size under jsdom, so it stays `visibility: hidden` and role queries skip it.
    fireEvent.click(screen.getByText('closePanel'))
    expect(api.panels.map(panel => panel.id)).toEqual(['a'])
  })

  it('falls back to the default layout when Dockview rejects the saved one', () => {
    const storage = memoryStorage()
    createLayoutStore({ storage }).set({
      grid: { root: { type: 'leaf', data: [] }, width: 1, height: 1, orientation: Orientation.HORIZONTAL },
      panels: {},
    })
    const { api } = renderWorkbench(registryWith('a'), storage)
    expect(api.panels.map(panel => panel.id)).toEqual(['a'])
  })

  it('opens a panel another plugin asks for, even when asked before the view mounted', () => {
    const registry = registryWith('a', 'b', 'late')
    registry.open('late')
    const storage = memoryStorage()
    const { api } = renderWorkbench(registry, storage)
    expect(api.getPanel('late')?.api.isActive).toBe(true)
    act(() => api.getPanel('late')?.api.close())

    act(() => registry.open('late'))
    expect(api.getPanel('late')).toBeDefined()
    expect(registry.hasOpenRequests()).toBe(false)
  })
})
