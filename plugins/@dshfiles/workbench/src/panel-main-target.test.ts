import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { panelMainTarget } from './panel-main-target.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

const surfaces: DockviewApi[] = []
afterEach(() => {
  for (const api of surfaces.splice(0)) api.dispose()
})

it('resolves a reusable occurrence to its native main target', () => {
  const registry = createWorkbenchPanelRegistry()
  registry.register({ id: 'source', title: 'Source', mainPanelId: 'native-main', component: () => null })
  const api = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  surfaces.push(api)
  const panel = api.addPanel({ id: 'view/source/one', component: WORKBENCH_COMPONENT, params: { sourceId: 'source' } })
  expect(panelMainTarget({ panel, registry })).toBe('native-main')
  const restored = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  surfaces.push(restored)
  restored.fromJSON(api.toJSON())
  expect(panelMainTarget({ panel: restored.getPanel(panel.id), registry })).toBe('native-main')
})

it('resolves legacy exact ids and declines missing or unregistered sources', () => {
  const registry = createWorkbenchPanelRegistry()
  registry.register({ id: 'legacy', title: 'Legacy', mainPanelId: 'native-main', component: () => null })
  registry.register({ id: 'ordinary', title: 'Ordinary', component: () => null })
  const api = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  surfaces.push(api)
  const legacy = api.addPanel({ id: 'legacy', component: WORKBENCH_COMPONENT })
  const ordinary = api.addPanel({ id: 'ordinary', component: WORKBENCH_COMPONENT })
  const missing = api.addPanel({ id: 'view/missing/one', component: WORKBENCH_COMPONENT, params: { sourceId: 'missing' } })
  const malformed = api.addPanel({ id: 'legacy-fallback', component: WORKBENCH_COMPONENT, params: { sourceId: '' } })
  registry.register({ id: 'legacy-fallback', title: 'Fallback', mainPanelId: 'native-fallback', component: () => null })
  expect(panelMainTarget({ panel: legacy, registry })).toBe('native-main')
  expect(panelMainTarget({ panel: ordinary, registry })).toBeUndefined()
  expect(panelMainTarget({ panel: missing, registry })).toBeUndefined()
  expect(panelMainTarget({ panel: malformed, registry })).toBe('native-fallback')
  expect(panelMainTarget({ panel: undefined, registry })).toBeUndefined()
})
