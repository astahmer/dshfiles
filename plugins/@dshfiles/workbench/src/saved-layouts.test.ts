import type { SerializedDockview } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { createNestedLayoutStores, layoutSchema } from './layout-store.js'
import { SavedLayouts, savedLayouts, type SavedLayout } from './saved-layouts.js'

/** Test double: built through the store's own schema, so it is exactly what storage accepts. */
const arrangement = (panelId: string): SerializedDockview =>
  layoutSchema.parse({
    grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
    panels: { [panelId]: { id: panelId, contentComponent: 'workbench-panel' } },
  })

describe('saved layouts', () => {
  it('round-trips explicit empty roots and saved region presentation alongside legacy snapshots', () => {
    savedLayouts.remove()
    expect(
      savedLayouts.set({
        full: { main: null, dock: arrangement('dock'), bottom: null, presentation: { bottomShown: false, rightMode: 'native' } },
        legacy: { main: arrangement('main') },
      }),
    ).toBe(true)
    savedLayouts.reload()
    expect(savedLayouts.get().full).toEqual({ main: null, dock: arrangement('dock'), bottom: null, presentation: { bottomShown: false, rightMode: 'native' } })
    expect(savedLayouts.get().legacy).toEqual({ main: arrangement('main') })
    savedLayouts.remove()
  })

  it('captures and restores unmounted nested stores while preserving legacy named regions', () => {
    const values = new Map<string, string>()
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    })
    const stores = createNestedLayoutStores({ storage })
    stores.store('nested/main/outer').set(arrangement('inner-container'))
    stores.store('nested/main/outer/inner').set(arrangement('editor'))
    const root = { main: arrangement('outer-container') }
    const captured = SavedLayouts.captureNested(root, stores)
    savedLayouts.remove()
    expect(savedLayouts.set({ nested: captured, legacy: root })).toBe(true)
    const roundTripped = savedLayouts.get().nested
    if (roundTripped === undefined) throw new Error('Nested snapshot was not retained')
    const freshStores = createNestedLayoutStores({ storage })
    freshStores.store('nested/main/outer/inner').remove()
    SavedLayouts.restoreNested(roundTripped, freshStores)
    expect(freshStores.store('nested/main/outer/inner').get()?.panels).toHaveProperty('editor')
    expect(roundTripped.main).toEqual(root.main)
    SavedLayouts.restoreNested(root, freshStores)
    expect(freshStores.store('nested/main/outer/inner').get()?.panels).toHaveProperty('editor')
    savedLayouts.remove()
  })

  it('round-trips through browser storage', () => {
    savedLayouts.remove()
    const saved = savedLayouts.set(SavedLayouts.with({}, 'bottom jujutsu', { bottom: arrangement('jujutsu') }))

    expect(saved).toBe(true)
    expect(SavedLayouts.surface(savedLayouts.get()['bottom jujutsu'] ?? {}, 'bottom')?.panels).toHaveProperty('jujutsu')
    savedLayouts.remove()
  })

  it('saves an arrangement under a name, replacing one it already holds', () => {
    const first = SavedLayouts.with({}, 'two panes', { dock: arrangement('jujutsu') })
    const replaced = SavedLayouts.with(first, 'two panes', { dock: arrangement('editor') })

    expect(SavedLayouts.names(first)).toEqual(['two panes'])
    expect(SavedLayouts.surface(replaced['two panes'] ?? {}, 'dock')?.panels).toHaveProperty('editor')
  })

  it('drops a name and lists the rest alphabetically', () => {
    const layouts = SavedLayouts.with(SavedLayouts.with({}, 'zeta', { dock: arrangement('a') }), 'alpha', { dock: arrangement('b') })

    expect(SavedLayouts.names(layouts)).toEqual(['alpha', 'zeta'])
    expect(SavedLayouts.names(SavedLayouts.without(layouts, 'alpha'))).toEqual(['zeta'])
    expect(SavedLayouts.without(layouts, 'missing')).toEqual(layouts)
  })

  it('renames in place, keeping the arrangement, and ignores an absent source', () => {
    const layouts = SavedLayouts.with({}, 'old', { main: arrangement('editor'), bottom: arrangement('jujutsu') })
    const renamed = SavedLayouts.renamed(layouts, 'old', 'new')

    expect(SavedLayouts.names(renamed)).toEqual(['new'])
    expect(SavedLayouts.surface(renamed['new'] ?? {}, 'bottom')?.panels).toHaveProperty('jujutsu')
    expect(SavedLayouts.renamed(layouts, 'missing', 'new')).toEqual(layouts)
  })

  it('reports only the regions a layout recorded', () => {
    const layout: SavedLayout = { dock: arrangement('jujutsu') }

    expect(SavedLayouts.surface(layout, 'dock')).toBeDefined()
    expect(SavedLayouts.surface(layout, 'bottom')).toBeUndefined()
  })
})
