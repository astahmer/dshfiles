import type { SerializedDockview } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { SavedLayouts, savedLayouts, type SavedLayout } from './saved-layouts.js'

/** Test double: the store only round-trips these objects, it never renders them. */
const arrangement = (panelId: string): SerializedDockview =>
  // SAFETY: the store validates the shape it stores with `layoutSchema`; this
  // fixture carries exactly the fields that schema requires.
  ({
    grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
    panels: { [panelId]: { id: panelId, contentComponent: 'workbench-panel' } },
  }) as unknown as SerializedDockview

describe('saved layouts', () => {
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
