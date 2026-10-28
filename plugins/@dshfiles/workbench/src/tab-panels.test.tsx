import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SavedLayout } from './saved-layouts.js'
import type { SemanticScopeLayouts } from './semantic-layouts.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { createTabPanelAdapter, semanticTabMove, tabPanelId } from './tab-panels.js'
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
  globalThis.dshfilesWorkbenchTabsV1 = undefined
  document.body.replaceChildren()
})

const thread = (sessionId: string, options: Partial<Extract<WorkbenchTab, { kind: 'thread' }>> = {}): WorkbenchTab => ({
  id: `thread:${sessionId}`,
  kind: 'thread',
  target: { kind: 'thread', sessionId },
  sessionId,
  title: sessionId,
  active: true,
  pinned: false,
  preview: true,
  available: true,
  status: null,
  ...options,
})
const fixture = (scopeLayouts?: SemanticScopeLayouts) => {
  let snapshot: WorkbenchTabsSnapshot = { enabled: true, scopeKey: 'project:test', activeTabId: null, tabs: [] }
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
    }),
  )
  const element = document.createElement('div')
  document.body.append(element)
  const released: string[] = []
  const api = createDockview(element, {
    createComponent: options => ({
      element: document.createElement('div'),
      init: () => undefined,
      dispose: () => {
        released.push(options.id)
      },
    }),
  })
  api.layout(1000, 600)
  disposers.push(() => api.dispose())
  const registry = createWorkbenchPanelRegistry()
  const threadComponent = vi.fn(() => () => null)
  const panelComponent = vi.fn(() => () => null)
  const open = vi.fn((id: string) => {
    api.addPanel({ id, component: 'body', title: registry.get(id)?.title ?? id })
  })
  const surfaces: DockviewApi[] = [api]
  const adapter = createTabPanelAdapter({ registry, thread: threadComponent, panel: panelComponent, surfaces: () => surfaces, open, scopeLayouts })
  disposers.push(adapter.dispose)
  const set = (tabs: readonly WorkbenchTab[], activeTabId = tabs.at(-1)?.id ?? null) => {
    snapshot = { ...snapshot, tabs, activeTabId }
    for (const listener of listeners) listener()
    adapter.sync()
  }
  const enable = (enabled: boolean) => {
    snapshot = { ...snapshot, enabled }
    for (const listener of listeners) listener()
    adapter.sync()
  }
  const scope = (scopeKey: string, tabs: readonly WorkbenchTab[]) => {
    snapshot = { ...snapshot, scopeKey, tabs, activeTabId: tabs.at(-1)?.id ?? null }
    adapter.sync()
  }
  return { api, registry, actions, adapter, set, enable, scope, surfaces, open, released, threadComponent, panelComponent }
}

describe('semantic tab user move translation', () => {
  const order = (ids: readonly string[], pinned: readonly string[] = []) => {
    const registry = createWorkbenchPanelRegistry()
    const tabs = ids.map(id => thread(id, { pinned: pinned.includes(id) }))
    for (const tab of tabs) registry.register({ id: tabPanelId(tab.id), title: tab.title, component: () => null, tabId: tab.id })
    registry.register({ id: 'ordinary', title: 'Ordinary', component: () => null })
    const snapshot: WorkbenchTabsSnapshot = { enabled: true, scopeKey: 'project:test', activeTabId: tabs[0]?.id ?? null, tabs }
    const move = (id: string, local: readonly string[]) =>
      semanticTabMove({
        movedPanelId: id === 'ordinary' ? id : tabPanelId(`thread:${id}`),
        orderedPanelIds: local.map(value => (value === 'ordinary' ? value : tabPanelId(`thread:${value}`))),
        registry,
        snapshot,
      })
    return { move, registry, snapshot }
  }

  it('translates left and right reorders while ignoring ordinary panel positions', () => {
    const tabs = order(['a', 'b', 'c'])
    expect(tabs.move('c', ['c', 'ordinary', 'a', 'b'])).toEqual({ tabId: 'thread:c', toIndex: 0 })
    expect(tabs.move('a', ['b', 'ordinary', 'c', 'a'])).toEqual({ tabId: 'thread:a', toIndex: 2 })
    expect(tabs.move('b', ['a', 'ordinary', 'b', 'c'])).toBeNull()
    expect(tabs.move('ordinary', ['a', 'ordinary', 'b'])).toBeNull()
  })

  it('anchors a split group subset to its semantic neighbor without dropping other actor tabs', () => {
    const tabs = order(['a', 'b', 'c', 'd'])
    expect(tabs.move('d', ['d', 'b'])).toEqual({ tabId: 'thread:d', toIndex: 1 })
    expect(tabs.move('b', ['d', 'b'])).toEqual({ tabId: 'thread:b', toIndex: 3 })
    expect(tabs.move('b', ['b'])).toBeNull()
  })

  it('preserves pin group bounds and declines absent, disabled or stale occurrences', () => {
    const tabs = order(['p', 'a', 'b'], ['p'])
    expect(tabs.move('b', ['b', 'p', 'a'])).toEqual({ tabId: 'thread:b', toIndex: 1 })
    expect(tabs.move('p', ['a', 'b', 'p'])).toBeNull()
    expect(tabs.move('missing', ['missing', 'a'])).toBeNull()
    expect(
      semanticTabMove({
        movedPanelId: tabPanelId('thread:a'),
        orderedPanelIds: [tabPanelId('thread:b'), tabPanelId('thread:a')],
        registry: tabs.registry,
        snapshot: { ...tabs.snapshot, enabled: false },
      }),
    ).toBeNull()
  })
})

describe('semantic tab Dockview adapter', () => {
  it('adopts the canonical container selection during a stale panel-flag notification', () => {
    const tabs = fixture()
    const a = thread('a')
    const b = thread('b')
    let publishSelection = false
    let observed = false
    const listener = tabs.api.onDidActivePanelChange(event => {
      if (!publishSelection || event.panel?.id !== tabPanelId(a.id)) return
      publishSelection = false
      observed = true
      // Container activation is already A, but later per-panel listeners have
      // not updated B's flag yet. Publish the real owner selection at this seam.
      expect(tabs.api.getPanel(tabPanelId(b.id))?.api.isActive).toBe(true)
      tabs.set([a, b], b.id)
    })
    disposers.push(() => listener.dispose())
    tabs.set([a, b], a.id)
    const first = tabs.api.getPanel(tabPanelId(a.id))
    const second = tabs.api.getPanel(tabPanelId(b.id))
    if (first === undefined || second === undefined) throw new Error('Real semantic panels missing')
    second.api.setActive()
    publishSelection = true
    first.api.setActive()
    expect(observed).toBe(true)
    expect(tabs.api.activePanel?.id).toBe(second.id)
    expect(tabs.actions.activate).not.toHaveBeenCalled()
  })

  it('projects canonical plugin view names while preserving conversation and scoped titles', () => {
    const tabs = fixture()
    const component = () => null
    tabs.registry.register({ id: 'main/plugins', mainPanelId: 'plugins', title: 'Plugin Manager: Plugins', component })
    const panel: WorkbenchTab = {
      id: 'panel:plugins',
      kind: 'panel',
      panelId: 'plugins',
      target: { kind: 'panel', panelId: 'plugins' },
      title: 'Plugins',
      active: true,
      pinned: false,
      preview: false,
      available: true,
      status: null,
    }
    const scoped: WorkbenchTab = {
      ...panel,
      id: 'panel:plugins#custom',
      target: { kind: 'panel', panelId: 'plugins', scope: 'custom' },
      title: 'My scoped title',
    }
    tabs.set([thread('user', { title: 'My conversation title' }), panel, scoped])
    expect(tabs.api.getPanel(tabPanelId(panel.id))?.title).toBe('Plugin Manager: Plugins')
    expect(tabs.registry.get(tabPanelId(panel.id))?.title).toBe('Plugin Manager: Plugins')
    expect(tabs.api.getPanel(tabPanelId(scoped.id))?.title).toBe('My scoped title')
    expect(tabs.api.getPanel(tabPanelId('thread:user'))?.title).toBe('My conversation title')
    tabs.registry.register({ id: 'main/plugins', mainPanelId: 'plugins', title: 'Plugin Manager: 插件', component })
    expect(tabs.api.getPanel(tabPanelId(panel.id))?.title).toBe('Plugin Manager: 插件')
    expect(tabs.actions.open).not.toHaveBeenCalled()
    expect(tabs.actions.close).not.toHaveBeenCalled()
  })

  it('projects keyboard Start tabs into the same New tab chooser without changing actor identity', () => {
    const tabs = fixture()
    const start: WorkbenchTab = {
      id: 'start:chooser',
      kind: 'start',
      target: { kind: 'start' },
      title: 'Legacy Start',
      active: true,
      pinned: false,
      preview: false,
      available: true,
      status: null,
    }
    tabs.set([start])
    const definition = tabs.registry.get(tabPanelId(start.id))
    expect(definition).toMatchObject({ newView: true, title: 'New tab', tabId: start.id, hiddenFromAdd: true })
    expect(tabs.api.getPanel(tabPanelId(start.id))?.title).toBe('New tab')
    definition?.beforeClose?.()
    expect(tabs.actions.close).toHaveBeenCalledWith(start.id)
  })

  it('preserves the initial ordinary container selection across delayed provider adoption but follows later semantic selection', () => {
    const tabs = fixture()
    const container = tabs.api.addPanel({ id: 'nested-container', component: 'body', title: 'Nested surface' })
    tabs.set([thread('a')])
    expect(tabs.api.activePanel).toBe(container)
    expect(tabs.actions.activate).not.toHaveBeenCalled()
    tabs.set([thread('a'), thread('b')])
    expect(tabs.api.activePanel?.id).toBe(tabPanelId('thread:b'))
  })

  it('restores actor order and pins in existing group slots without moving ordinary panels or stealing focus', () => {
    const tabs = fixture()
    tabs.set([thread('a'), thread('b'), thread('c')])
    const group = tabs.api.activeGroup
    if (group === undefined) throw new Error('No group')
    const ordinary = tabs.api.addPanel({ id: 'ordinary', component: 'body', position: { referenceGroup: group } })
    ordinary.api.moveTo({ group, index: 1, skipSetActive: true })
    tabs.set([thread('c', { pinned: true }), thread('a'), thread('b')])
    expect(group.panels.map(panel => panel.id)).toEqual([tabPanelId('thread:c'), 'ordinary', tabPanelId('thread:a'), tabPanelId('thread:b')])
    expect(tabs.actions.move).not.toHaveBeenCalled()
  })

  it('removes stale saved semantic occurrences that were never registered in this mount', () => {
    const tabs = fixture()
    tabs.api.addPanel({ id: tabPanelId('thread:old-project'), component: 'body' })
    tabs.set([thread('a')])
    expect(tabs.api.getPanel(tabPanelId('thread:old-project'))).toBeUndefined()
    expect(tabs.api.getPanel(tabPanelId('thread:a'))).toBeDefined()
  })

  it('captures full per-scope main bottom and nested topology before removal and restores it on return', () => {
    let stored: Record<string, SavedLayout> = {}
    const store = {
      get: () => stored,
      set: (next: Record<string, SavedLayout>) => {
        stored = next
        return true
      },
    }
    let tabs: ReturnType<typeof fixture>
    const extra = () => {
      const element = document.createElement('div')
      document.body.append(element)
      const api = createDockview(element, { createComponent: () => ({ element: document.createElement('div'), init: () => undefined }) })
      api.layout(600, 400)
      disposers.push(() => api.dispose())
      return api
    }
    const bottom = extra()
    const nested = extra()
    const capture = (): SavedLayout => ({ main: tabs.api.toJSON(), bottom: bottom.toJSON(), nested: { 'nested/test': nested.toJSON() } })
    const restore = (layout: SavedLayout) => {
      if (layout.main) tabs.api.fromJSON(layout.main)
      if (layout.bottom) bottom.fromJSON(layout.bottom)
      if (layout.nested?.['nested/test']) nested.fromJSON(layout.nested['nested/test'])
    }
    tabs = fixture({ capture, restore, store })
    tabs.surfaces.push(bottom, nested)
    tabs.scope('project:a', [thread('a'), thread('b'), thread('c')])
    const bId = tabPanelId('thread:b'),
      cId = tabPanelId('thread:c')
    tabs.api.getPanel(bId)?.api.close()
    bottom.addPanel({ id: bId, component: 'body' })
    tabs.api.getPanel(cId)?.api.close()
    nested.addPanel({ id: cId, component: 'body' })
    nested.addPanel({ id: 'ordinary', component: 'body', position: { direction: 'right' } })
    const expected = capture()
    tabs.scope('project:b', [thread('different')])
    expect(stored['project:a']).toEqual(expected)
    tabs.scope('project:a', [thread('a'), thread('b'), thread('c')])
    // Selection may activate a restored panel, but the serialized topology remains exact.
    expect(bottom.toJSON().grid).toEqual(expected.bottom?.grid)
    expect(nested.toJSON().grid).toEqual(expected.nested?.['nested/test']?.grid)
    expect(bottom.getPanel(bId)).toBeDefined()
    expect(nested.getPanel(cId)).toBeDefined()
    expect(tabs.api.getPanel(tabPanelId('thread:different'))).toBeUndefined()
    expect(tabs.actions.close).not.toHaveBeenCalled()
  })

  it('reconciles real Dockview API activation without navigating back into the semantic actor', () => {
    const tabs = fixture()
    const origins: string[] = []
    const subscription = tabs.api.onDidActivePanelChange(event => {
      origins.push(event.origin)
    })
    disposers.push(() => subscription.dispose())
    tabs.set([thread('a'), thread('b')], 'thread:a')
    expect(tabs.api.activePanel?.id).toBe(tabPanelId('thread:a'))
    expect(origins.every(origin => origin === 'api')).toBe(true)
    expect(tabs.actions.activate).not.toHaveBeenCalled()
    expect(tabs.actions.open).not.toHaveBeenCalled()
    tabs.adapter.sync()
    expect(tabs.open).toHaveBeenCalledTimes(2)
    expect(tabs.actions.activate).not.toHaveBeenCalled()
  })

  it('keeps Plugins selected when replacing the second thread preview without feeding neighbor activation back into the actor', () => {
    const tabs = fixture()
    const first = thread('first', { preview: false })
    tabs.set([first, thread('second')], 'thread:second')
    const origins: Array<{ id: string | undefined; origin: string }> = []
    const subscription = tabs.api.onDidActivePanelChange(event => {
      const tabId = event.panel === undefined ? undefined : tabs.registry.get(event.panel.id)?.tabId
      origins.push({ id: tabId, origin: event.origin })
      if (event.origin === 'user' && tabId !== undefined) tabs.actions.activate(tabId)
    })
    disposers.push(() => subscription.dispose())
    const plugins: WorkbenchTab = {
      id: 'panel:plugins',
      kind: 'panel',
      panelId: 'plugins',
      target: { kind: 'panel', panelId: 'plugins' },
      title: 'Plugins',
      active: true,
      pinned: false,
      preview: true,
      available: true,
      status: null,
    }
    tabs.set([first, plugins], plugins.id)
    expect(tabs.api.activePanel?.id).toBe(tabPanelId(plugins.id))
    expect(tabs.actions.activate, JSON.stringify(origins)).not.toHaveBeenCalled()
    tabs.adapter.sync()
    expect(tabs.api.activePanel?.id).toBe(tabPanelId(plugins.id))
  })

  it('releases the replaced preview registry occurrence and real panel without a semantic close', () => {
    const tabs = fixture()
    tabs.set([thread('a')])
    const oldId = tabPanelId('thread:a')
    expect(tabs.api.getPanel(oldId)).toBeDefined()
    tabs.set([thread('b')])
    expect(tabs.api.getPanel(oldId)).toBeUndefined()
    expect(tabs.registry.get(oldId)).toBeUndefined()
    expect(tabs.released).toContain(oldId)
    expect(tabs.api.panels.map(panel => panel.id)).toEqual([tabPanelId('thread:b')])
    expect(tabs.actions.close).not.toHaveBeenCalled()
  })

  it('keeps component identity and panel instance while title, status and preview metadata change', () => {
    const tabs = fixture()
    tabs.set([thread('a')])
    const id = tabPanelId('thread:a')
    const component = tabs.registry.get(id)?.component
    const panel = tabs.api.getPanel(id)
    tabs.set([thread('a', { title: 'Renamed', status: 'unread', preview: false })])
    expect(tabs.registry.get(id)?.component).toBe(component)
    expect(tabs.api.getPanel(id)).toBe(panel)
    expect(panel?.title).toBe('Renamed')
    expect(tabs.threadComponent).toHaveBeenCalledTimes(1)
    expect(tabs.open).toHaveBeenCalledTimes(1)
    expect(tabs.released).toEqual([])
  })

  it('does not steal an ordinary panel focus on status-only or title-only semantic updates', () => {
    const tabs = fixture()
    tabs.set([thread('a'), thread('b')], 'thread:a')
    tabs.registry.register({ id: 'ordinary', title: 'Ordinary', component: () => null })
    const ordinary = tabs.api.addPanel({ id: 'ordinary', component: 'body' })
    expect(tabs.api.activePanel).toBe(ordinary)
    tabs.set([thread('a', { status: 'running', title: 'Renamed A' }), thread('b')], 'thread:a')
    expect(tabs.api.activePanel).toBe(ordinary)
    tabs.adapter.sync()
    expect(tabs.api.activePanel).toBe(ordinary)
    tabs.set([thread('a'), thread('b')], 'thread:b')
    expect(tabs.api.activePanel?.id).toBe(tabPanelId('thread:b'))
  })

  it('routes one explicit close to semantics and never replays it during actor reconciliation', () => {
    const tabs = fixture()
    tabs.set([thread('a')])
    const id = tabPanelId('thread:a')
    tabs.registry.get(id)?.beforeClose?.()
    expect(tabs.actions.close).toHaveBeenCalledExactlyOnceWith('thread:a')
    tabs.set([])
    tabs.adapter.sync()
    expect(tabs.actions.close).toHaveBeenCalledTimes(1)
    expect(tabs.api.panels).toHaveLength(0)
    expect(tabs.registry.list()).toHaveLength(0)
  })

  it('retires disabled semantic occurrences without closing actor tabs and restores them on re-enable', () => {
    const tabs = fixture()
    tabs.registry.register({ id: 'ordinary', title: 'Ordinary panel', component: () => null })
    tabs.api.addPanel({ id: 'ordinary', component: 'body' })
    tabs.set([thread('a'), thread('b')])
    tabs.enable(false)
    for (const id of ['thread:a', 'thread:b']) {
      expect(tabs.api.getPanel(tabPanelId(id))).toBeUndefined()
      expect(tabs.registry.get(tabPanelId(id))).toBeUndefined()
    }
    expect(tabs.registry.get('ordinary')).toBeDefined()
    expect(tabs.api.getPanel('ordinary')).toBeDefined()
    expect(tabs.actions.close).not.toHaveBeenCalled()
    tabs.enable(true)
    expect(tabs.api.getPanel(tabPanelId('thread:a'))).toBeDefined()
    expect(tabs.api.getPanel(tabPanelId('thread:b'))).toBeDefined()
    expect(tabs.api.activePanel?.id).toBe(tabPanelId('thread:b'))
    expect(tabs.actions.open).not.toHaveBeenCalled()
  })

  it('keeps separate scoped panel subjects and does not recreate their components on activation', () => {
    const tabs = fixture()
    const panel = (scope: string): WorkbenchTab => ({
      id: `panel:jujutsu#${scope}`,
      kind: 'panel',
      panelId: 'jujutsu',
      target: { kind: 'panel', panelId: 'jujutsu', scope },
      title: scope,
      active: true,
      pinned: false,
      preview: false,
      available: true,
      status: null,
    })
    tabs.set([panel('one'), panel('two')])
    tabs.set([panel('one'), panel('two')], 'panel:jujutsu#one')
    expect(tabs.panelComponent.mock.calls).toEqual([
      ['jujutsu', 'one'],
      ['jujutsu', 'two'],
    ])
    expect(tabs.api.activePanel?.id).toBe(tabPanelId('panel:jujutsu#one'))
    expect(tabs.registry.list().every(definition => definition.hiddenFromAdd)).toBe(true)
  })
})
