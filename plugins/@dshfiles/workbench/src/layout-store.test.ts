import { createDockview, Orientation, type DockviewApi, type SerializedDockview } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLayoutStore, createNestedLayoutStores, WorkbenchLayout, WORKBENCH_COMPONENT } from './layout-store.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const dockviews: DockviewApi[] = []
afterEach(() => {
  for (const api of dockviews.splice(0)) api.dispose()
})
const dockview = (): DockviewApi => {
  const api = createDockview(document.createElement('div'), { createComponent: () => ({ element: document.createElement('div'), init: () => {} }) })
  dockviews.push(api)
  return api
}

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    values,
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }),
  }
}

const layout: SerializedDockview = {
  grid: { root: { type: 'branch', data: [] }, width: 800, height: 600, orientation: Orientation.HORIZONTAL },
  panels: { a: { id: 'a', contentComponent: WORKBENCH_COMPONENT, title: 'A' } },
  activeGroup: '1',
}

describe('layout store', () => {
  it('opens Navigation and Threads as separate tab-controlled sidebar groups', () => {
    const api = dockview()
    WorkbenchLayout.applyDefaultLayout(
      api,
      [
        { id: 'dshfiles-thread-sidebar.workbench-threads', title: 'Threads', component: () => null },
        { id: 'dshfiles-thread-sidebar.workbench-navigation', title: 'Navigation', component: () => null },
      ],
      'threads',
    )
    expect(api.groups).toHaveLength(2)
    expect(api.activePanel?.title).toBe('Threads')
    expect(api.panels.map(panel => panel.title).sort()).toEqual(['Navigation', 'Threads'])
  })

  it('starts with conversation only when explicitly chosen as the initial default', () => {
    const panels = [
      { id: 'dshfiles-editor.main', title: 'Editor', component: () => null },
      { id: 'conversation', title: 'Conversation', component: () => null },
    ]
    const api = dockview()
    WorkbenchLayout.applyDefaultLayout(api, panels, 'conversation')
    expect(api.panels.map(panel => panel.id)).toEqual(['conversation'])
    WorkbenchLayout.applyDefaultLayout(api, panels, 'editor')
    expect(api.panels.map(panel => panel.id)).toEqual(['dshfiles-editor.main'])
  })

  it('migrates an explicitly conversation-default layout without losing legacy panels or active selection', () => {
    const api = dockview()
    api.addPanel({ id: 'legacy-tools', title: 'Tools', component: WORKBENCH_COMPONENT })
    const store = createLayoutStore({ storage: memoryStorage().storage })
    store.set(api.toJSON())
    const panels = [{ id: 'conversation', title: 'Conversation', component: () => null }]
    expect(WorkbenchLayout.restoreLayout(api, store, panels, 'editor')).toBe('restored')
    expect(api.panels.map(panel => panel.id)).toEqual(['legacy-tools'])
    expect(WorkbenchLayout.restoreLayout(api, store, panels, 'conversation')).toBe('restored')
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['conversation', 'legacy-tools'])
    expect(api.activePanel?.id).toBe('legacy-tools')
    store.set(api.toJSON())
    WorkbenchLayout.restoreLayout(api, store, panels, 'conversation')
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['conversation', 'legacy-tools'])
  })

  it('clears an existing API when the default layout is empty', () => {
    const clear = vi.fn()
    const addPanel = vi.fn(() => {
      throw new Error('Empty defaults must not add panels')
    })
    WorkbenchLayout.applyDefaultLayout({ clear, addPanel }, [], 'empty')
    expect(clear).toHaveBeenCalledOnce()
    expect(addPanel).not.toHaveBeenCalled()
  })

  it('keeps legacy root storage keys and gives nested paths independent versioned keys', () => {
    const memory = memoryStorage()
    for (const surface of ['main', 'left', 'dock', 'bottom', 'side-panel'] as const) createLayoutStore({ surface, storage: memory.storage }).set(layout)
    const nested = createLayoutStore({ surface: 'nested/main/a/deep', storage: memory.storage })
    nested.set(layout)
    expect([...memory.values.keys()]).toEqual([
      'dshfiles.workbench.layout.v1',
      'dshfiles.workbench.left-layout.v1',
      'dshfiles.workbench.dock-layout.v1',
      'dshfiles.workbench.bottom-layout.v1',
      'dshfiles.workbench.side-panel-layout.v1',
      'dshfiles.workbench.nested-layout.v1:nested/main/a/deep',
    ])
    expect(createLayoutStore({ surface: 'nested/main/other', storage: memory.storage }).get()).toBeNull()
    expect(createLayoutStore({ surface: 'nested/main/a/deep', storage: memory.storage }).get()).toEqual(layout)
  })

  it('indexes unmounted nested stores and restores through a shared live store', () => {
    const memory = memoryStorage()
    const stores = createNestedLayoutStores({ storage: memory.storage })
    const store = stores.store('nested/main/a')
    store.set(layout)
    expect(stores.store('nested/main/a')).toBe(store)
    const remounted = createNestedLayoutStores({ storage: memory.storage })
    expect(remounted.paths()).toEqual(['nested/main/a'])
    expect(remounted.capture()).toEqual({ 'nested/main/a': layout })
    const changed = vi.fn()
    store.subscribe(changed)
    stores.restore({ 'nested/main/a': null, 'nested/main/a/b': layout })
    expect(store.get()).toBeNull()
    expect(changed).toHaveBeenCalledOnce()
    expect(stores.capture()).toEqual({ 'nested/main/a': null, 'nested/main/a/b': layout })
  })

  it('round-trips a Dockview layout through storage, keeping fields it does not model', () => {
    const memory = memoryStorage()
    expect(createLayoutStore({ storage: memory.storage }).set(layout)).toBe(true)
    expect(createLayoutStore({ storage: memory.storage }).get()).toEqual(layout)
  })

  it('keeps the side-panel layout apart from the main-area one', () => {
    const memory = memoryStorage()
    createLayoutStore({ surface: 'side-panel', storage: memory.storage }).set(layout)
    expect(createLayoutStore({ storage: memory.storage }).get()).toBeNull()
    expect(createLayoutStore({ surface: 'side-panel', storage: memory.storage }).get()).toEqual(layout)
  })

  it('keeps the global dock layout apart from the main-area and side-panel ones', () => {
    const memory = memoryStorage()
    createLayoutStore({ surface: 'dock', storage: memory.storage }).set(layout)
    expect(createLayoutStore({ storage: memory.storage }).get()).toBeNull()
    expect(createLayoutStore({ surface: 'side-panel', storage: memory.storage }).get()).toBeNull()
    expect(createLayoutStore({ surface: 'dock', storage: memory.storage }).get()).toEqual(layout)
  })

  it('reads a layout from another component, malformed JSON or a missing grid as no layout', () => {
    const memory = memoryStorage()
    const store = createLayoutStore({ storage: memory.storage })
    const key = 'dshfiles.workbench.layout.v1'
    for (const raw of [JSON.stringify({ ...layout, panels: { a: { id: 'a', contentComponent: 'other' } } }), '{not json', JSON.stringify({ panels: {} })]) {
      memory.values.set(key, raw)
      store.reload()
      expect(store.get()).toBeNull()
    }
  })
})
