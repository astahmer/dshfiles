import { createDockview, type DockviewApi, type SerializedDockview } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { captureLayoutArrangement, restoreLayoutArrangement, type ArrangementSurface } from './layout-arrangements.js'
import { createLayoutStore, createNestedLayoutStores, layoutSchema } from './layout-store.js'
import { createWorkbenchRegionRegistry } from './dock-regions.js'
import { nestedPanelId } from './nested-surfaces.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const apis: DockviewApi[] = []
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose()
})
const layout = (id: string): SerializedDockview =>
  layoutSchema.parse({
    grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
    panels: { [id]: { id, contentComponent: 'workbench-panel' } },
  })
const surface = (value: SerializedDockview, onRestore = () => {}): ArrangementSurface => ({
  toJSON: () => value,
  fromJSON: vi.fn(() => onRestore()),
  clear: vi.fn(() => onRestore()),
  getPanel: () => undefined,
})
const ports = () => {
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
  return {
    rootStores: {
      main: createLayoutStore({ storage }),
      left: createLayoutStore({ surface: 'left', storage }),
      dock: createLayoutStore({ surface: 'dock', storage }),
      bottom: createLayoutStore({ surface: 'bottom', storage }),
    },
    nestedStores: createNestedLayoutStores({ storage }),
    regions: createWorkbenchRegionRegistry<ArrangementSurface>(),
  }
}
const containing = (id: string): ArrangementSurface => {
  const api = createDockview(document.createElement('div'), { createComponent: () => ({ element: document.createElement('div'), init: () => {} }) })
  apis.push(api)
  api.addPanel({ id, component: 'workbench-panel' })
  return { toJSON: () => api.toJSON(), fromJSON: vi.fn(), clear: vi.fn(), getPanel: key => api.getPanel(key) }
}

describe('layout arrangements', () => {
  it('captures every root including closed storage and null plus live nested state before persistence flush', () => {
    const p = ports()
    p.rootStores.dock.set(layout('closed-dock'))
    p.nestedStores.store('nested/main/closed').set(layout('closed-nested'))
    p.nestedStores.store('nested/main/live').set(layout('stale-nested'))
    p.regions.set('main', surface(layout('live-main')))
    p.regions.set('nested/main/live', surface(layout('live-nested')))
    expect(captureLayoutArrangement({ ...p, presentation: { bottomShown: false, rightMode: 'native' } })).toEqual({
      main: layout('live-main'),
      left: null,
      dock: layout('closed-dock'),
      bottom: null,
      nested: { 'nested/main/closed': layout('closed-nested'), 'nested/main/live': layout('live-nested') },
      presentation: { bottomShown: false, rightMode: 'native' },
    })
  })

  it('writes nested and closed root stores before restoring APIs and honors saved visibility', () => {
    const p = ports()
    const main = surface(layout('old'), () => {
      expect(p.rootStores.bottom.get()).toEqual(layout('closed-bottom'))
      expect(p.nestedStores.store('nested/main/a').get()).toEqual(layout('nested-child'))
    })
    p.regions.set('main', main)
    const setBottomShown = vi.fn()
    const setRightMode = vi.fn()
    restoreLayoutArrangement(
      {
        main: layout('new'),
        dock: null,
        bottom: layout('closed-bottom'),
        nested: { 'nested/main/a': layout('nested-child') },
        presentation: { bottomShown: false, rightMode: 'native' },
      },
      { ...p, setBottomShown, setRightMode },
    )
    expect(main.fromJSON).toHaveBeenCalledWith(layout('new'))
    expect(p.rootStores.dock.get()).toBeNull()
    expect(setBottomShown).toHaveBeenCalledExactlyOnceWith(false)
    expect(setRightMode).toHaveBeenCalledExactlyOnceWith('native')
  })

  it('never calls a stale descendant API after its parent was restored', () => {
    const p = ports()
    const path = 'nested/main/a'
    const parent = containing(nestedPanelId(path))
    const child = surface(layout('old-child'))
    p.regions.set('main', parent)
    p.regions.set(path, child)
    restoreLayoutArrangement({ main: layout('new-root'), nested: { [path]: layout('new-child') } }, p)
    expect(parent.fromJSON).toHaveBeenCalledOnce()
    expect(child.fromJSON).not.toHaveBeenCalled()
    expect(p.nestedStores.store(path).get()).toEqual(layout('new-child'))
  })

  it('restores moved nested parents before children and checks registry identity after earlier mutations', () => {
    const p = ports()
    const parentPath = 'nested/main/z-parent'
    const childPath = 'nested/main/a-child'
    const parent = containing(nestedPanelId(childPath))
    const child = surface(layout('old-child'))
    // Child sorts before parent by path; real containment must decide order.
    p.regions.set(childPath, child)
    p.regions.set(parentPath, parent)
    restoreLayoutArrangement({ nested: { [parentPath]: layout('new-parent'), [childPath]: layout('new-child') } }, p)
    expect(parent.fromJSON).toHaveBeenCalledOnce()
    expect(child.fromJSON).not.toHaveBeenCalled()

    const stale = surface(layout('stale'))
    const replacement = surface(layout('replacement'))
    p.regions.set('bottom', stale)
    const main = surface(layout('main'), () => {
      p.regions.set('bottom', replacement)
    })
    p.regions.set('main', main)
    restoreLayoutArrangement({ main: layout('restore-main'), bottom: layout('restore-bottom') }, p)
    expect(stale.fromJSON).not.toHaveBeenCalled()
    expect(replacement.fromJSON).not.toHaveBeenCalled()
    expect(p.rootStores.bottom.get()).toEqual(layout('restore-bottom'))
  })

  it('clears explicit null live roots and restores independent nested APIs when no ancestor changed', () => {
    const p = ports()
    const main = surface(layout('old-main'))
    const nested = surface(layout('old-nested'))
    p.regions.set('main', main)
    p.regions.set('nested/right/independent', nested)
    restoreLayoutArrangement({ main: null, nested: { 'nested/right/independent': layout('new-nested') } }, p)
    expect(main.clear).toHaveBeenCalledOnce()
    expect(p.rootStores.main.get()).toBeNull()
    expect(nested.fromJSON).toHaveBeenCalledWith(layout('new-nested'))
  })

  it('keeps legacy omitted regions untouched and opens recorded closed regions without flags', () => {
    const p = ports()
    p.rootStores.main.set(layout('untouched'))
    const setBottomShown = vi.fn()
    const setRightMode = vi.fn()
    restoreLayoutArrangement({ dock: layout('legacy-dock'), bottom: null }, { ...p, setBottomShown, setRightMode })
    expect(p.rootStores.main.get()).toEqual(layout('untouched'))
    expect(setBottomShown).toHaveBeenCalledWith(true)
    expect(setRightMode).toHaveBeenCalledWith('dock')
  })
})
