import { describe, expect, it } from 'vitest'
import { createWorkbenchRegionRegistry, type WorkbenchRegionSurface } from './dock-regions.js'

/** Test double: the registry only asks a surface which panels it holds. */
const surface = (ids: readonly string[]): WorkbenchRegionSurface => ({
  getPanel: (id: string) => (ids.includes(id) ? { id } : undefined),
})

const registryFor = () => createWorkbenchRegionRegistry<WorkbenchRegionSurface>()

describe('workbench region registry', () => {
  it('registers a surface, replaces it and lets only the owner remove it', () => {
    const registry = registryFor()

    const disposeFirst = registry.set('right', surface(['a']))
    const second = surface(['b'])
    registry.set('right', second)

    disposeFirst()
    expect(registry.get('right')).toBe(second)

    registry.set('right', second)()
    expect(registry.get('right')).toBeUndefined()
  })

  it('keeps a surface whose newer registration outlived the older disposer', () => {
    const registry = registryFor()
    const api = surface(['a'])

    const disposeFirst = registry.set('bottom', api)
    registry.set('bottom', api)
    disposeFirst()

    expect(registry.get('bottom')).toBe(api)
  })

  it('tells whether any mounted region already shows a panel', () => {
    const registry = registryFor()
    registry.set('right', surface(['jujutsu.dock']))

    expect(registry.holds('jujutsu.dock')).toBe(true)
    expect(registry.holds('editor.main')).toBe(false)
  })

  it('orders root surfaces first and arbitrary nested paths after them', () => {
    const registry = registryFor()
    registry.set('nested/main/z/deep', surface(['deep']))
    registry.set('nested/main/a', surface(['a']))
    registry.set('bottom', surface([]))
    registry.set('right', surface([]))
    registry.set('main', surface([]))
    expect(registry.entries().map(([region]) => region)).toEqual(['main', 'right', 'bottom', 'nested/main/a', 'nested/main/z/deep'])
    expect(registry.holds('deep')).toBe(true)
  })

  it('lists the mounted regions in a stable order and skips the rest', () => {
    const registry = registryFor()
    const bottom = surface([])
    registry.set('bottom', bottom)
    registry.set('main', surface([]))

    expect(registry.entries().map(([region]) => region)).toEqual(['main', 'bottom'])
  })
})
