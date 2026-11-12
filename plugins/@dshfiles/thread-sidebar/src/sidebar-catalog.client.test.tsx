// @vitest-environment jsdom
import { createWorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarCatalog } from './sidebar-catalog.js'

const component = (): null => null
const pages = [{ id: 'traces', label: 'Traces', order: 1 }] as const
const destinations = [{ sections: [] }] as const

describe('SidebarCatalog.useCatalog', () => {
  it('keeps one catalog while thread switches replace occurrences it does not list', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'view/a', title: 'Alpha', component })
    const seen = new Set<readonly unknown[]>()
    const { result } = renderHook(() => {
      const catalog = SidebarCatalog.useCatalog({ pages, destinations, registry })
      seen.add(catalog)
      return catalog
    })
    let closeOccurrence = (): void => {}
    for (let thread = 0; thread < 10; thread++) {
      act(() => {
        closeOccurrence()
        closeOccurrence = registry.register({ id: `tab/${String(thread)}`, title: `Thread ${String(thread)}`, tabId: `tab-${String(thread)}`, component })
      })
    }
    expect(seen.size).toBe(1)
    act(() => {
      registry.register({ id: 'view/b', title: 'Beta', component })
    })
    expect(seen.size).toBe(2)
    expect(result.current.map(panel => panel.title)).toEqual(['Traces', 'Alpha', 'Beta'])
  })
})
