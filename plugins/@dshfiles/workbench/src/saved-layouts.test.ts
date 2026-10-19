import type { SerializedDockview } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { layoutNames, renamedSavedLayout, savedSurface, withSavedLayout, withoutSavedLayout, type SavedLayout } from './saved-layouts.js'

/** Test double: the store only round-trips these objects, it never renders them. */
const arrangement = (panelId: string): SerializedDockview =>
  ({
    grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
    panels: { [panelId]: { id: panelId, contentComponent: 'workbench-panel' } },
  }) as unknown as SerializedDockview

describe('saved layouts', () => {
  it('saves an arrangement under a name, replacing one it already holds', () => {
    const first = withSavedLayout({}, 'two panes', { dock: arrangement('jujutsu') })
    const replaced = withSavedLayout(first, 'two panes', { dock: arrangement('editor') })

    expect(layoutNames(first)).toEqual(['two panes'])
    expect(savedSurface(replaced['two panes'] ?? {}, 'dock')?.panels).toHaveProperty('editor')
  })

  it('drops a name and lists the rest alphabetically', () => {
    const layouts = withSavedLayout(withSavedLayout({}, 'zeta', { dock: arrangement('a') }), 'alpha', { dock: arrangement('b') })

    expect(layoutNames(layouts)).toEqual(['alpha', 'zeta'])
    expect(layoutNames(withoutSavedLayout(layouts, 'alpha'))).toEqual(['zeta'])
    expect(withoutSavedLayout(layouts, 'missing')).toEqual(layouts)
  })

  it('renames in place, keeping the arrangement, and ignores an absent source', () => {
    const layouts = withSavedLayout({}, 'old', { main: arrangement('editor'), bottom: arrangement('jujutsu') })
    const renamed = renamedSavedLayout(layouts, 'old', 'new')

    expect(layoutNames(renamed)).toEqual(['new'])
    expect(savedSurface(renamed['new'] ?? {}, 'bottom')?.panels).toHaveProperty('jujutsu')
    expect(renamedSavedLayout(layouts, 'missing', 'new')).toEqual(layouts)
  })

  it('reports only the regions a layout recorded', () => {
    const layout: SavedLayout = { dock: arrangement('jujutsu') }

    expect(savedSurface(layout, 'dock')).toBeDefined()
    expect(savedSurface(layout, 'bottom')).toBeUndefined()
  })
})
