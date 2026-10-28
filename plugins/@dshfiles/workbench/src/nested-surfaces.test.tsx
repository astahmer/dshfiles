import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkbenchRegionRegistry, type WorkbenchRegionSurface } from './dock-regions.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { layoutSchema, nestedLayoutStores } from './layout-store.js'
import {
  canMovePanelToRegion,
  createNestedSurface,
  createNestedSurfaceRegistry,
  nestedPanelId,
  nestedSurfaceDefinitions,
  nestedSurfacePath,
  type NestedSurfaceProps,
} from './nested-surfaces.js'

const surface = (ids: readonly string[]): WorkbenchRegionSurface => ({ getPanel: id => (ids.includes(id) ? {} : undefined) })

afterEach(() => {
  cleanup()
  nestedSurfaceDefinitions.remove()
})

describe('nested surfaces', () => {
  it('cleans newly added and restored registrations on teardown without erasing saved identities', () => {
    const registry = createWorkbenchPanelRegistry()
    const component = () => <div />
    const owner = createNestedSurfaceRegistry(registry, component)
    const first = owner.add('main', 'First')
    const second = owner.add('right', 'Second')
    owner.restore()
    expect(registry.list()).toEqual([first, second])
    owner.dispose()
    expect(registry.list()).toEqual([])
    expect(nestedSurfaceDefinitions.get()).toHaveLength(2)
    const replacement = createNestedSurfaceRegistry(registry, component)
    replacement.restore()
    const restored = registry.list()
    replacement.restore()
    expect(registry.list()).toEqual(restored)
    replacement.dispose()
    expect(registry.list()).toEqual([])
  })

  it('allocates unique persistent hierarchical identities at arbitrary depth', () => {
    const outer = nestedSurfacePath('main', 'outer')
    const inner = nestedSurfacePath(outer, 'inner')
    expect(inner).toBe('nested/main/outer/inner')
    expect(nestedSurfacePath(inner, 'deep')).toBe('nested/main/outer/inner/deep')
    expect(nestedSurfacePath('main')).not.toBe(nestedSurfacePath('main'))
    expect(() => nestedSurfacePath('main', '../escape')).toThrow()
    expect(nestedPanelId(inner)).toBe('dshfiles-workbench.nested/main/outer/inner')
  })

  it('creates a registry definition using the supplied view without a circular view import', () => {
    const path = nestedSurfacePath('main', 'factory')
    const View = (props: NestedSurfaceProps): JSX.Element => {
      expect(props.store).toBe(nestedLayoutStores.store(path))
      return (
        <div data-testid="nested-view">
          {props.region}:{props.surface}
        </div>
      )
    }
    const definition = createNestedSurface({ path, title: 'Nested tools', component: View })
    const Panel = definition.component
    render(<Panel panelId={definition.id} />)
    expect(screen.getByTestId('nested-view').textContent).toBe(`${path}:${path}`)
    expect(nestedSurfaceDefinitions.get()).toEqual([{ path, title: 'Nested tools' }])
    nestedSurfaceDefinitions.reload()
    const rehydrated = createNestedSurface({ ...(nestedSurfaceDefinitions.get()[0] ?? { path, title: 'Missing' }), component: View })
    expect(rehydrated.id).toBe(definition.id)
    expect(nestedSurfaceDefinitions.get()).toHaveLength(1)
  })

  it('rejects self and ancestral containers entering descendants but allows ordinary panels and moving out', () => {
    const regions = createWorkbenchRegionRegistry<WorkbenchRegionSurface>()
    const outer = nestedSurfacePath('main', 'a')
    const inner = nestedSurfacePath(outer, 'b')
    regions.set('main', surface([nestedPanelId(outer)]))
    regions.set(outer, surface([nestedPanelId(inner)]))
    regions.set(inner, surface(['editor']))
    expect(canMovePanelToRegion(nestedPanelId(outer), outer, regions)).toBe(false)
    expect(canMovePanelToRegion(nestedPanelId(outer), inner, regions)).toBe(false)
    expect(canMovePanelToRegion(nestedPanelId(inner), outer, regions)).toBe(true)
    expect(canMovePanelToRegion(nestedPanelId(inner), 'right', regions)).toBe(true)
    expect(canMovePanelToRegion('editor', inner, regions)).toBe(true)
  })

  it('uses live containment after a container moves instead of assuming its path is its current parent', () => {
    const regions = createWorkbenchRegionRegistry<WorkbenchRegionSurface>()
    const a = nestedSurfacePath('main', 'a')
    const b = nestedSurfacePath('main', 'b')
    const c = nestedSurfacePath(a, 'c')
    regions.set('main', surface([nestedPanelId(b)]))
    regions.set(b, surface([nestedPanelId(a)]))
    regions.set(a, surface([nestedPanelId(c)]))
    regions.set(c, surface([]))
    expect(canMovePanelToRegion(nestedPanelId(b), c, regions)).toBe(false)
    expect(canMovePanelToRegion(nestedPanelId(c), b, regions)).toBe(true)
    regions.set('main', surface([nestedPanelId(a), nestedPanelId(c)]))
    expect(canMovePanelToRegion(nestedPanelId(a), c, regions)).toBe(true)
  })

  it('checks persisted containment of unmounted containers after cross-branch moves', () => {
    const regions = createWorkbenchRegionRegistry<WorkbenchRegionSurface>()
    const a = nestedSurfacePath('main', 'saved-a')
    const b = nestedSurfacePath('main', 'saved-b')
    const c = nestedSurfacePath('main', 'saved-c')
    const arrangement = (id: string) =>
      layoutSchema.parse({
        grid: { root: { type: 'branch', data: [] }, width: 1, height: 1, orientation: 'HORIZONTAL' },
        panels: { [id]: { id, contentComponent: 'workbench-panel' } },
      })
    expect(
      canMovePanelToRegion(nestedPanelId(a), c, regions, {
        [a]: arrangement(nestedPanelId(b)),
        [b]: arrangement(nestedPanelId(c)),
      }),
    ).toBe(false)
    regions.set('main', surface([nestedPanelId(c)]))
    expect(canMovePanelToRegion(nestedPanelId(a), c, regions, { [a]: arrangement(nestedPanelId(c)) })).toBe(true)
  })

  it('rejects unmounted origin descendants and corrupted existing containment loops', () => {
    const regions = createWorkbenchRegionRegistry<WorkbenchRegionSurface>()
    const a = nestedSurfacePath('main', 'a')
    const b = nestedSurfacePath('main', 'b')
    expect(canMovePanelToRegion(nestedPanelId(a), nestedSurfacePath(a, 'closed'), regions)).toBe(false)
    regions.set(a, surface([nestedPanelId(b)]))
    regions.set(b, surface([nestedPanelId(a)]))
    expect(canMovePanelToRegion(nestedPanelId(nestedSurfacePath('main', 'c')), a, regions)).toBe(false)
  })
})
