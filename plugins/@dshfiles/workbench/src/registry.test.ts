import { describe, expect, it } from 'vitest'
import { createWorkbenchPanelRegistry, workbenchPanels, type WorkbenchPanelDefinition } from './registry.js'

const panel = (id: string): WorkbenchPanelDefinition => ({ id, title: id, component: () => null })

describe('workbench panel registry', () => {
  it('lists registrations in order and drops a disposed one', () => {
    const registry = createWorkbenchPanelRegistry()
    const disposeA = registry.register(panel('a'))
    registry.register(panel('b'))
    expect(registry.list().map(entry => entry.id)).toEqual(['a', 'b'])
    disposeA()
    expect(registry.list().map(entry => entry.id)).toEqual(['b'])
    expect(registry.get('a')).toBeUndefined()
  })

  it('rejects malformed panel identities before adding them to the registry', () => {
    const registry = createWorkbenchPanelRegistry()
    expect(() => registry.register(panel(''))).toThrow('Workbench panel id and title must be valid.')
    expect(() => registry.register({ ...panel('valid-id'), title: ' ' })).toThrow('Workbench panel id and title must be valid.')
    expect(registry.list()).toEqual([])
  })

  it('keeps a re-registration when the stale disposer of the replaced one runs', () => {
    const registry = createWorkbenchPanelRegistry()
    const disposeOld = registry.register(panel('a'))
    const replacement = panel('a')
    registry.register(replacement)
    disposeOld()
    expect(registry.get('a')).toBe(replacement)
  })

  it('returns a stable list snapshot between changes and notifies subscribers on change', () => {
    const registry = createWorkbenchPanelRegistry()
    let notified = 0
    registry.subscribe(() => (notified += 1))
    registry.register(panel('a'))
    const snapshot = registry.list()
    expect(registry.list()).toBe(snapshot)
    expect(notified).toBe(1)
  })

  it('validates panel preference writes and persists visibility and ordering choices', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ ...panel('prefs-a'), showInContextMenu: true, showInEmptyState: true })
    registry.register(panel('prefs-b'))
    expect(registry.preference('prefs-a')).toEqual({ contextMenu: true, emptyState: true, order: 0 })
    expect(registry.listContextMenuPanels().map(definition => definition.id)).toEqual(['prefs-a'])
    expect(registry.setPreference('missing', { contextMenu: true, emptyState: true, order: 0 })).toBe(false)
    expect(registry.setPreference('prefs-a', { contextMenu: true, emptyState: false, order: 2.5 })).toBe(false)
    expect(registry.setPreference('prefs-a', { contextMenu: false, emptyState: true, order: 0 })).toBe(true)
    expect(registry.preference('prefs-a')).toEqual({ contextMenu: false, emptyState: true, order: 0 })
    expect(registry.listContextMenuPanels()).toEqual([])
    expect(registry.movePreference('prefs-b', 'earlier')).toBe(true)
    expect(registry.preference('prefs-b')?.order).toBe(0)
    expect(registry.preference('prefs-a')?.order).toBe(1)
    expect(registry.movePreference('prefs-b', 'earlier')).toBe(false)
  })

  it('excludes runtime occurrences from reusable context choices even with old enabled preferences', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ ...panel('runtime-occurrence'), hiddenFromAdd: true, showInContextMenu: true })
    registry.setPreference('runtime-occurrence', { contextMenu: true, emptyState: true, order: 0 })
    expect(registry.get('runtime-occurrence')).toBeDefined()
    expect(registry.listContextMenuPanels()).toEqual([])
  })

  it('keeps open requests, deduplicated and latest last, until the workbench takes them', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.open('a')
    registry.open('b')
    registry.open('a')
    expect(registry.hasOpenRequests()).toBe(true)
    expect(registry.takeOpenRequests()).toEqual(['b', 'a'])
    expect(registry.hasOpenRequests()).toBe(false)
    expect(registry.takeOpenRequests()).toEqual([])
  })

  it('shares one page-wide instance across bundles through a global symbol', () => {
    const first = workbenchPanels()
    first.register(panel('shared'))
    expect(workbenchPanels()).toBe(first)
    expect(globalThis.dshfilesWorkbenchPanelsV1).toBe(first)
  })
})
