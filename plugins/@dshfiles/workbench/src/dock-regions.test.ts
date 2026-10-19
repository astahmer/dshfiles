import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { createWorkbenchRegionRegistry } from './dock-regions.js'

/** Test double: the registry only asks a surface which panels it holds. */
const surface = (ids: readonly string[]): Pick<DockviewApi, 'getPanel'> => ({
  getPanel: (id: string) => (ids.includes(id) ? ({ id } as unknown as IDockviewPanel) : undefined),
})

describe('workbench region registry', () => {
  it('registers a surface, replaces it and lets only the owner remove it', () => {
    const registry = createWorkbenchRegionRegistry()

    const disposeFirst = registry.set('right', surface(['a']) as unknown as DockviewApi)
    const second = surface(['b']) as unknown as DockviewApi
    registry.set('right', second)

    disposeFirst()
    expect(registry.get('right')).toBe(second)

    registry.set('right', second)()
    expect(registry.get('right')).toBeUndefined()
  })

  it('keeps a surface whose newer registration outlived the older disposer', () => {
    const registry = createWorkbenchRegionRegistry()
    const api = surface(['a']) as unknown as DockviewApi

    const disposeFirst = registry.set('bottom', api)
    registry.set('bottom', api)
    disposeFirst()

    expect(registry.get('bottom')).toBe(api)
  })

  it('tells whether any mounted region already shows a panel', () => {
    const registry = createWorkbenchRegionRegistry()
    registry.set('right', surface(['jujutsu.dock']) as unknown as DockviewApi)

    expect(registry.holds('jujutsu.dock')).toBe(true)
    expect(registry.holds('editor.main')).toBe(false)
  })

  it('lists the mounted regions in a stable order and skips the rest', () => {
    const registry = createWorkbenchRegionRegistry()
    const bottom = surface([]) as unknown as DockviewApi
    registry.set('bottom', bottom)
    registry.set('main', surface([]) as unknown as DockviewApi)

    expect(registry.entries().map(([region]) => region)).toEqual(['main', 'bottom'])
  })
})
