import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorkbenchRegionRegistry } from './dock-regions.js'
import { captureLayoutArrangement, restoreLayoutArrangement } from './layout-arrangements.js'
import { createLayoutStore, createNestedLayoutStores, WorkbenchLayout } from './layout-store.js'
import { nestedPanelId } from './nested-surfaces.js'
import { MainSurfaceGuard } from './main-surface-guard.js'
import { NewViewTabs } from './new-view.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { createResettableAsidePlacement, WorkbenchReset } from './reset-layout.js'
import { savedLayouts } from './saved-layouts.js'
import { semanticLayouts } from './semantic-layouts.js'
import { createTabPanelAdapter, tabPanelId } from './tab-panels.js'
import { connectWorkbenchTabs, type WorkbenchTab, type WorkbenchTabsActions, type WorkbenchTabsSnapshot } from './tabs.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  semanticLayouts.remove()
  savedLayouts.remove()
  globalThis.dshfilesWorkbenchTabsV1 = undefined
})
const surface = (): DockviewApi => {
  const api = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  api.layout(1000, 600)
  disposers.push(() => api.dispose())
  return api
}
const add = (api: DockviewApi, id: string): void => {
  api.addPanel({ id, title: id, component: 'workbench-panel' })
}
const stores = () => {
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
  return {
    storage,
    rootStores: {
      main: createLayoutStore({ storage }),
      dock: createLayoutStore({ surface: 'dock', storage }),
      bottom: createLayoutStore({ surface: 'bottom', storage }),
      left: createLayoutStore({ surface: 'left', storage }),
    },
    sideStore: createLayoutStore({ surface: 'side-panel', storage }),
    nestedStores: createNestedLayoutStores({ storage }),
  }
}
const tab = (sessionId: string, active: boolean): WorkbenchTab => ({
  id: `thread:${sessionId}`,
  kind: 'thread',
  target: { kind: 'thread', sessionId },
  sessionId,
  title: sessionId,
  active,
  pinned: !active,
  preview: active,
  available: true,
  status: 'unread',
})
const actions = (): WorkbenchTabsActions => ({
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
})

describe('coordinated presentation reset', () => {
  it('selects the authoritative current semantic editor owner instead of cloning an input behind the active tool', () => {
    const main = surface()
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'current-conversation', title: 'Current conversation', component: () => null })
    registry.register({ id: 'chat-owner', title: 'My chat', tabId: 'chat-tab', component: () => null })
    add(main, 'chat-owner')
    add(main, 'tool-owner')
    add(main, 'current-conversation')
    const chat = main.getPanel('chat-owner')
    if (chat === undefined) throw new Error('Missing existing chat owner')
    main.addFloatingGroup(chat)
    const snapshot: WorkbenchTabsSnapshot = {
      enabled: true,
      scopeKey: 'global',
      activeTabId: 'tool-tab',
      currentSessionId: 'session-current',
      tabs: [
        {
          id: 'chat-tab',
          kind: 'thread',
          target: { kind: 'thread', sessionId: 'session-current' },
          sessionId: 'session-current',
          title: 'My chat',
          active: false,
          pinned: true,
          preview: false,
          available: true,
          status: null,
        },
      ],
    }
    const before = JSON.stringify(snapshot)
    expect(WorkbenchReset.conversation(main, registry, snapshot)).toBe('chat-tab')
    expect(main.activePanel).toBe(chat)
    expect(chat.group.api.location.type).toBe('grid')
    expect(main.getPanel('current-conversation')).toBeUndefined()
    expect(main.getPanel('tool-owner')).toBeDefined()
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('recovers semantic tabs from bottom/nested layouts, clears closed scopes, and survives two resets and a remount without actor actions', () => {
    const p = stores()
    const regions = createWorkbenchRegionRegistry()
    const main = surface()
    const left = surface()
    const right = surface()
    const bottom = surface()
    const nestedParent = surface()
    const nestedChild = surface()
    const side = surface()
    regions.set('main', main)
    regions.set('left', left)
    regions.set('right', right)
    regions.set('bottom', bottom)
    regions.set('nested/main/z-parent', nestedParent)
    regions.set('nested/main/a-child', nestedChild)
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'conversation', title: 'Conversation', component: () => null })
    for (const id of ['dshfiles-thread-sidebar.workbench-threads', 'dshfiles-thread-sidebar.workbench-navigation'])
      registry.register({ id, title: id, component: () => null })
    const snapshot: WorkbenchTabsSnapshot = { enabled: true, scopeKey: 'project:a', activeTabId: 'thread:b', tabs: [tab('a', false), tab('b', true)] }
    const actorActions = actions()
    disposers.push(connectWorkbenchTabs({ getSnapshot: () => snapshot, subscribe: () => () => undefined, actions: actorActions, renderStart: () => null }))
    const arrangementPorts = { rootStores: p.rootStores, nestedStores: p.nestedStores, regions }
    const capture = () => captureLayoutArrangement({ ...arrangementPorts, presentation: { bottomShown: true, rightMode: 'dock' } })
    const adapter = createTabPanelAdapter({
      registry,
      thread: () => () => null,
      panel: () => () => null,
      surfaces: () => regions.entries().map(([, api]) => api),
      open: id => add(main, id),
      scopeLayouts: { capture, restore: layout => restoreLayoutArrangement(layout, arrangementPorts) },
    })
    disposers.push(adapter.dispose)
    adapter.sync()
    for (const panel of [...main.panels]) main.removePanel(panel)
    add(main, nestedPanelId('nested/main/z-parent'))
    add(nestedParent, nestedPanelId('nested/main/a-child'))
    add(nestedChild, tabPanelId('thread:b'))
    add(bottom, tabPanelId('thread:a'))
    add(right, 'ordinary')
    add(side, 'legacy')
    const old = capture()
    for (const [name, store] of Object.entries(p.rootStores)) {
      const api = { main, dock: right, left }[name] ?? bottom
      store.set(api.toJSON())
    }
    p.sideStore.set(side.toJSON())
    p.nestedStores.store('nested/main/z-parent').set(nestedParent.toJSON())
    p.nestedStores.store('nested/main/a-child').set(nestedChild.toJSON())
    p.nestedStores.store('nested/right/unmounted').set(bottom.toJSON())
    semanticLayouts.set({ 'project:a': old, 'project:b': old })
    const discardPendingPlacements = vi.fn()
    const reset = () =>
      WorkbenchReset.run({
        ...arrangementPorts,
        sideStore: p.sideStore,
        sideSurfaces: () => [side],
        discardPendingPlacements,
        clearScopeLayouts: () => semanticLayouts.remove(),
        restoreMain: () => {
          // Every stale descendant must already be empty before reconciliation.
          expect(nestedChild.panels).toHaveLength(0)
          expect(nestedParent.panels).toHaveLength(0)
          adapter.sync()
          p.rootStores.main.set(main.toJSON())
        },
        restoreLeft: () => {
          WorkbenchLayout.applyDefaultLayout(left, registry.list(), 'threads')
          p.rootStores.left.set(left.toJSON())
        },
      })
    reset()
    reset()
    expect(discardPendingPlacements).toHaveBeenCalledTimes(2)
    expect(main.panels.map(panel => panel.id)).toEqual(snapshot.tabs.map(value => tabPanelId(value.id)))
    expect(main.activePanel?.id).toBe(tabPanelId('thread:b'))
    expect(left.panels.map(panel => panel.id)).toEqual(
      expect.arrayContaining(['dshfiles-thread-sidebar.workbench-threads', 'dshfiles-thread-sidebar.workbench-navigation']),
    )
    for (const api of [right, bottom, nestedParent, nestedChild, side]) expect(api.panels).toHaveLength(0)
    expect(p.sideStore.get()).toBeNull()
    expect(p.rootStores.dock.get()).toBeNull()
    expect(p.rootStores.bottom.get()).toBeNull()
    for (const path of p.nestedStores.paths()) expect(p.nestedStores.store(path).get()).toBeNull()
    expect(semanticLayouts.get()).toEqual({})
    for (const action of Object.values(actorActions)) expect(action).not.toHaveBeenCalled()
    // Fresh store objects and a fresh real Dockview prove the reset does not
    // depend on an in-memory empty cache or a later persistence event.
    const remount = surface()
    WorkbenchLayout.restoreLayout(remount, createLayoutStore({ storage: p.storage }), registry.list(), 'editor')
    expect(remount.panels.map(panel => panel.id)).toEqual(snapshot.tabs.map(value => tabPanelId(value.id)))
    expect(remount.activePanel?.id).toBe(tabPanelId('thread:b'))
    expect(createNestedLayoutStores({ storage: p.storage }).capture()).toEqual({
      'nested/main/z-parent': null,
      'nested/main/a-child': null,
      'nested/right/unmounted': null,
    })
  })

  it.each(['left', 'right', 'bottom', 'nested/main/thread', 'floating'] as const)(
    'shows the current conversation in the centre when the semantic selection is a tool and the thread was %s',
    displacedTo => {
      const p = stores()
      const main = surface()
      const displaced = surface()
      const regions = createWorkbenchRegionRegistry<DockviewApi>()
      regions.set('main', main)
      regions.set(displacedTo === 'floating' ? 'right' : displacedTo, displaced)
      const registry = createWorkbenchPanelRegistry()
      registry.register({ id: 'current-conversation', title: 'Rich Composer: Current conversation', component: () => null })
      const panelTab: WorkbenchTab = {
        id: 'panel:editor',
        kind: 'panel',
        panelId: 'editor',
        target: { kind: 'panel', panelId: 'editor' },
        title: 'Editor',
        active: true,
        pinned: false,
        preview: false,
        available: true,
        status: null,
      }
      const snapshot: WorkbenchTabsSnapshot = {
        enabled: true,
        scopeKey: 'project:a',
        activeTabId: panelTab.id,
        tabs: [tab('a', false), panelTab],
      }
      const originalTabs = JSON.stringify(snapshot)
      const actorActions = actions()
      disposers.push(connectWorkbenchTabs({ getSnapshot: () => snapshot, subscribe: () => () => undefined, actions: actorActions, renderStart: () => null }))
      const adapter = createTabPanelAdapter({
        registry,
        thread: () => () => null,
        panel: () => () => null,
        surfaces: () => regions.entries().map(([, api]) => api),
        open: id => add(main, id),
      })
      disposers.push(adapter.dispose)
      adapter.sync()
      const thread = main.getPanel(tabPanelId('thread:a'))
      if (thread !== undefined) main.removePanel(thread)
      add(displaced, tabPanelId('thread:a'))
      if (displacedTo === 'floating' && displaced.activePanel !== undefined) displaced.addFloatingGroup(displaced.activePanel)
      savedLayouts.set({ 'My named layout': { main: main.toJSON(), dock: displaced.toJSON() } })
      const named = savedLayouts.get()
      const reset = () =>
        WorkbenchReset.run({
          ...p,
          regions,
          sideSurfaces: () => [],
          discardPendingPlacements: vi.fn(),
          clearScopeLayouts: vi.fn(),
          restoreMain: () => {
            adapter.sync()
            WorkbenchReset.conversation(main, registry)
            p.rootStores.main.set(main.toJSON())
          },
          restoreLeft: vi.fn(),
        })
      reset()
      reset()
      adapter.sync() // Metadata-only updates must not reactivate the semantic tool.
      expect(main.activePanel?.id).toBe('current-conversation')
      expect(main.activePanel?.api.location.type).toBe('grid')
      expect(main.panels.map(panel => panel.id)).toEqual(expect.arrayContaining(snapshot.tabs.map(value => tabPanelId(value.id))))
      expect(displaced.panels).toHaveLength(0)
      expect(JSON.stringify(snapshot)).toBe(originalTabs)
      expect(savedLayouts.get()).toEqual(named)
      for (const action of Object.values(actorActions)) expect(action).not.toHaveBeenCalled()
      const remount = surface()
      WorkbenchLayout.restoreLayout(remount, createLayoutStore({ storage: p.storage }), registry.list(), 'conversation')
      expect(remount.activePanel?.id).toBe('current-conversation')
      expect(remount.activePanel?.api.location.type).toBe('grid')
    },
  )

  it.each([false, true])('removes only ordinary reset placeholders with the permanent grid guard and semantic tabs=%s', semantic => {
    const main = surface()
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'current-conversation', title: 'Rich Composer: Current conversation', component: () => null })
    const snapshot: WorkbenchTabsSnapshot = {
      enabled: true,
      scopeKey: 'project:a',
      activeTabId: semantic ? 'start:a' : null,
      tabs: semantic
        ? [
            tab('a', false),
            {
              id: 'start:a',
              kind: 'start',
              target: { kind: 'start' },
              title: 'New tab',
              active: true,
              pinned: false,
              preview: false,
              available: true,
              status: null,
            },
          ]
        : [],
    }
    const original = JSON.stringify(snapshot)
    const actorActions = actions()
    disposers.push(connectWorkbenchTabs({ getSnapshot: () => snapshot, subscribe: () => () => undefined, actions: actorActions, renderStart: () => null }))
    const adapter = createTabPanelAdapter({
      registry,
      thread: () => () => null,
      panel: () => () => null,
      surfaces: () => [main],
      open: id => add(main, id),
    })
    disposers.push(adapter.dispose)
    disposers.push(MainSurfaceGuard.retain(main))
    main.clear() // A real reset now synchronously recreates an ordinary chooser.
    expect(main.panels.some(panel => NewViewTabs.isChooser(panel.id))).toBe(true)
    add(main, 'conversation')
    if (semantic) add(main, 'resource-panel')
    adapter.sync()
    WorkbenchReset.conversation(main, registry)
    WorkbenchReset.conversation(main, registry)
    adapter.sync()
    expect(main.panels.some(panel => NewViewTabs.isChooser(panel.id))).toBe(false)
    expect(main.getPanel('conversation')).toBeUndefined()
    expect(main.panels.map(panel => panel.id).sort()).toEqual(
      ['current-conversation', ...(semantic ? ['resource-panel', ...snapshot.tabs.map(value => tabPanelId(value.id))] : [])].sort(),
    )
    expect(main.activePanel?.id).toBe('current-conversation')
    expect(main.activePanel?.api.location.type).toBe('grid')
    expect(JSON.stringify(snapshot)).toBe(original)
    for (const action of Object.values(actorActions)) expect(action).not.toHaveBeenCalled()
  })

  it('never lets a floating active group capture the reset conversation', () => {
    const main = surface()
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'current-conversation', title: 'Rich Composer: Current conversation', component: () => null })
    add(main, 'tool')
    const floating = main.getPanel('tool')
    if (floating !== undefined) main.addFloatingGroup(floating)
    WorkbenchReset.conversation(main, registry)
    expect(main.activePanel?.id).toBe('current-conversation')
    expect(main.activePanel?.api.location.type).toBe('grid')
    const current = main.getPanel('current-conversation')
    if (current !== undefined) main.addFloatingGroup(current)
    WorkbenchReset.conversation(main, registry)
    expect(main.activePanel?.api.location.type).toBe('grid')
  })

  it.each([
    { mounted: true, corrupt: false },
    { mounted: false, corrupt: false },
    { mounted: true, corrupt: true },
    { mounted: false, corrupt: true },
  ])('restores and reveals the left default with $mounted mounted / $corrupt corrupt, including later attachment', ({ mounted, corrupt }) => {
    const p = stores()
    const regions = createWorkbenchRegionRegistry<DockviewApi>()
    const left = surface()
    const displaced = surface()
    const panels = ['dshfiles-thread-sidebar.workbench-threads', 'dshfiles-thread-sidebar.workbench-navigation'].map(id => ({
      id,
      title: id,
      component: () => null,
    }))
    for (const panel of panels) add(displaced, panel.id)
    regions.set('right', displaced)
    if (mounted) regions.set('left', left)
    // Neither valid-but-empty nor corrupt persisted layouts may suppress defaults.
    if (corrupt) p.storage().setItem('dshfiles.workbench.left-layout.v1', '{broken')
    else p.rootStores.left.set(left.toJSON())
    let sidebarShown = false
    const restoreLeft = vi.fn(() => {
      const api = regions.get('left')
      if (api !== undefined) {
        WorkbenchLayout.applyDefaultLayout(api, panels, 'threads')
        p.rootStores.left.set(api.toJSON())
      }
      sidebarShown = true
    })
    const ports = {
      ...p,
      regions,
      sideSurfaces: () => [],
      discardPendingPlacements: vi.fn(),
      clearScopeLayouts: vi.fn(),
      restoreMain: vi.fn(),
      restoreLeft,
    }
    WorkbenchReset.run(ports)
    expect(restoreLeft).toHaveBeenCalledOnce()
    expect(sidebarShown).toBe(true)
    if (!mounted) {
      regions.set('left', left)
      WorkbenchLayout.restoreLayout(left, createLayoutStore({ surface: 'left', storage: p.storage }), panels, 'threads')
    }
    expect(left.panels.map(panel => panel.id)).toEqual(panels.map(panel => panel.id))
    expect(left.activePanel?.id).toBe(panels[0]?.id)
    expect(displaced.panels).toHaveLength(0)
  })

  it('clears stored roots and restores a main conversation on later mount when no main API exists', () => {
    const p = stores()
    const old = surface()
    add(old, 'hidden-in-right')
    p.rootStores.main.set(old.toJSON())
    p.rootStores.dock.set(old.toJSON())
    const restoreMain = vi.fn()
    WorkbenchReset.run({
      ...p,
      regions: createWorkbenchRegionRegistry<DockviewApi>(),
      sideSurfaces: () => [],
      discardPendingPlacements: vi.fn(),
      clearScopeLayouts: vi.fn(),
      restoreMain,
      restoreLeft: vi.fn(),
    })
    expect(restoreMain).toHaveBeenCalledOnce()
    const remount = surface()
    WorkbenchLayout.restoreLayout(
      remount,
      createLayoutStore({ storage: p.storage }),
      [{ id: 'conversation', title: 'Conversation', component: () => null }],
      'conversation',
    )
    expect(remount.panels.map(panel => panel.id)).toEqual(['conversation'])
  })
})

describe('resettable Session-pane placement', () => {
  it('drops delayed handoffs but retains mounted attachment ownership across repeated resets', () => {
    const show = vi.fn()
    const placement = createResettableAsidePlacement<object>(show)
    placement.request('pending', 'old-panel')
    const live = {}
    const detach = placement.attach('live', live)
    placement.reset()
    placement.reset()
    placement.attach('pending', {})
    expect(show).not.toHaveBeenCalled()
    placement.request('live', 'new-panel')
    expect(show).toHaveBeenCalledExactlyOnceWith(live, 'new-panel')
    detach()
    expect(placement.surfaces()).not.toContain(live)
    placement.request('live', 'detached-panel')
    expect(show).toHaveBeenCalledTimes(1)
    placement.dispose()
  })

  it('a stale attach disposer cannot detach a replacement after reset', () => {
    const show = vi.fn()
    const placement = createResettableAsidePlacement<object>(show)
    const api = {}
    const stale = placement.attach('same-session', api)
    placement.attach('same-session', api)
    placement.reset()
    stale()
    placement.request('same-session', 'still-mounted')
    expect(show).toHaveBeenCalledExactlyOnceWith(api, 'still-mounted')
    placement.dispose()
  })
})
