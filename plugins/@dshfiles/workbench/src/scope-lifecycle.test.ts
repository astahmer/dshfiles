import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createWorkbenchPanelRegistry } from './registry.js'
import { createTabPanelAdapter, tabPanelId } from './tab-panels.js'
import { connectWorkbenchTabs, type WorkbenchTab, type WorkbenchTabsSnapshot } from './tabs.js'
import { NewViewTabs } from './new-view.js'
import type { SavedLayout } from './saved-layouts.js'

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
const thread = (id: string): WorkbenchTab => ({
  id: `thread:${id}`,
  kind: 'thread',
  sessionId: id,
  target: { kind: 'thread', sessionId: id },
  title: id,
  pinned: false,
  preview: false,
  active: id === 'a',
  available: true,
  status: null,
})
const nativeApi = (): DockviewApi => {
  const element = document.createElement('div')
  document.body.append(element)
  const api = createDockview(element, {
    createComponent: ({ id }) => {
      const body = document.createElement('textarea')
      body.value = `draft for ${id}`
      return { element: body, init: () => undefined }
    },
  })
  api.layout(1000, 600)
  disposers.push(() => api.dispose())
  return api
}
const order = (api: DockviewApi) => api.groups.flatMap(group => group.panels.map(panel => panel.id))

/** Consumer contract seam: actual actor scope policy is covered in MainTabs and the real two-project browser journey. */
const harness = (options: { current?: SavedLayout; cached?: Record<string, SavedLayout> } = {}) => {
  let snapshot: WorkbenchTabsSnapshot = {
    enabled: true,
    scopeKey: 'project:a',
    activeTabId: 'thread:a',
    currentSessionId: 'a',
    tabs: [thread('b'), thread('a')],
  }
  const listeners = new Set<() => void>()
  const actions = {
    activate: vi.fn(),
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
  const api = nativeApi()
  if (options.current?.main != null) api.fromJSON(options.current.main)
  const registry = createWorkbenchPanelRegistry()
  const destination = nativeApi()
  for (const id of ['a', 'b']) destination.addPanel({ id: tabPanelId(`thread:${id}`), title: id, component: 'body' })
  let cached: Record<string, SavedLayout> = options.cached ?? { 'project:b': { main: destination.toJSON() } }
  const restore = vi.fn((layout: SavedLayout) => {
    if (layout.main != null) api.fromJSON(layout.main)
  })
  const adapter = createTabPanelAdapter({
    registry,
    thread: () => () => null,
    panel: () => () => null,
    surfaces: () => [api],
    open: id => {
      api.addPanel({ id, component: 'body', title: registry.get(id)?.title ?? id })
    },
    scopeLayouts: {
      capture: () => ({ main: api.toJSON() }),
      restore,
      store: {
        get: () => cached,
        set: value => {
          cached = value
          return true
        },
      },
    },
  })
  disposers.push(adapter.dispose)
  adapter.sync()
  const addChooser = () => {
    const chooser = NewViewTabs.open(api)
    chooser.api.moveTo({ group: chooser.group, index: 0, position: 'center', skipSetActive: true })
    api.getPanel(tabPanelId('thread:a'))?.api.setActive()
    return chooser
  }
  const publish = (currentSessionId: string, scopeKey = snapshot.scopeKey) => {
    snapshot = {
      ...snapshot,
      scopeKey,
      currentSessionId,
      activeTabId: `thread:${currentSessionId}`,
      tabs: snapshot.tabs.map(tab => ({ ...tab, active: tab.id === `thread:${currentSessionId}` })),
    }
    for (const listener of listeners) listener()
    adapter.sync()
  }
  return { api, adapter, addChooser, publish, restore }
}

it('keeps the exact unrelated chooser and conversation instances when native current changes within the window scope', () => {
  const window = harness()
  const chooser = window.addChooser()
  const original = order(window.api)
  const first = window.api.getPanel(tabPanelId('thread:a'))
  const second = window.api.getPanel(tabPanelId('thread:b'))
  expect(original).toEqual([chooser.id, tabPanelId('thread:b'), tabPanelId('thread:a')])
  for (let cycle = 0; cycle < 3; cycle += 1) {
    window.publish('b')
    expect(window.api.activePanel?.id).toBe(tabPanelId('thread:b'))
    expect(order(window.api)).toEqual(original)
    expect(window.api.getPanel(chooser.id)).toBe(chooser)
    expect(window.api.getPanel(tabPanelId('thread:a'))).toBe(first)
    expect(window.api.getPanel(tabPanelId('thread:b'))).toBe(second)
    window.publish('a')
    expect(order(window.api)).toEqual(original)
  }
  expect(window.restore).not.toHaveBeenCalled()
})

it('still restores another cached scene when an explicit scope change is published', () => {
  const window = harness()
  const chooser = window.addChooser()
  window.publish('b', 'project:b')
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.api.getPanel(chooser.id)).toBeUndefined()
})

it('does not resurrect a closed ordinary chooser from an older scope cache during window hydration', () => {
  const old = harness()
  const chooser = old.addChooser()
  const stale: SavedLayout = { main: old.api.toJSON() }
  old.api.removePanel(chooser)
  const latest: SavedLayout = { main: old.api.toJSON() }
  const reload = harness({ current: latest, cached: { 'project:a': stale } })
  expect(order(reload.api)).toEqual([tabPanelId('thread:b'), tabPanelId('thread:a')])
  expect(reload.api.getPanel(chooser.id)).toBeUndefined()
  expect(reload.restore).not.toHaveBeenCalled()
})
