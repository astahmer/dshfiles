import type { PaletteActionContext } from '@dshfiles/command-palette/palette-contract'
import { createWorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { describe, expect, it } from 'vitest'
import { registerWorkbenchPaletteActions, workbenchPaletteActions } from './workbench-palette.js'

const context: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }

describe('workbench palette actions', () => {
  it('lists reusable views once without duplicating header destinations or occurrences', () => {
    const registry = createWorkbenchPanelRegistry()
    const component = () => null
    registry.register({ id: 'view/a', title: 'Alpha', component })
    registry.register({ id: 'view/main', title: 'Existing', mainPanelId: 'existing', component })
    registry.register({ id: 'view/one', title: 'One', mainPanelId: 'shared', component })
    registry.register({ id: 'view/two', title: 'Two', mainPanelId: 'shared', component })
    registry.register({ id: 'view/hidden', title: 'Hidden', hiddenFromAdd: true, component })
    registry.register({ id: 'view/tab', title: 'Occurrence', tabId: 'tab', component })
    registry.register({ id: 'conversation', title: 'Conversation', component })
    const actions = workbenchPaletteActions({ registry, existingMainPanelIds: new Set(['existing']) })
    expect(actions.map(action => (typeof action.label === 'string' ? action.label : action.label()))).toEqual(['Alpha', 'One'])
    actions[0]?.run(context)
    expect(registry.takeOpenRequests()).toEqual(['view/a'])
  })

  it('updates and removes actions as registrations change', () => {
    const registry = createWorkbenchPanelRegistry()
    let labels: readonly string[] = []
    const stop = registerWorkbenchPaletteActions({
      registry,
      existingMainPanelIds: new Set(),
      addActions: actions => {
        labels = actions.map(action => (typeof action.label === 'string' ? action.label : action.label()))
        return () => {
          labels = []
        }
      },
    })
    const remove = registry.register({ id: 'view/new', title: 'New view', component: () => null })
    expect(labels).toEqual(['New view'])
    remove()
    expect(labels).toEqual([])
    stop()
    registry.register({ id: 'view/later', title: 'Later', component: () => null })
    expect(labels).toEqual([])
  })

  it('adds nothing again while thread switches replace occurrences it does not list', () => {
    const registry = createWorkbenchPanelRegistry()
    const component = () => null
    registry.register({ id: 'view/a', title: 'Alpha', component })
    registry.register({ id: 'view/b', title: 'Beta', component })
    let added = 0
    const live = new Map<string, string>()
    const stop = registerWorkbenchPaletteActions({
      registry,
      existingMainPanelIds: new Set(),
      addActions: actions => {
        added += actions.length
        for (const action of actions) live.set(action.id, typeof action.label === 'string' ? action.label : action.label())
        return () => {
          for (const action of actions) live.delete(action.id)
        }
      },
    })
    expect(added).toBe(2)
    let closeOccurrence = (): void => {}
    for (let thread = 0; thread < 10; thread++) {
      closeOccurrence()
      closeOccurrence = registry.register({ id: `tab/${String(thread)}`, title: `Thread ${String(thread)}`, tabId: `tab-${String(thread)}`, component })
    }
    expect(added).toBe(2)
    registry.register({ id: 'view/b', title: 'Beta renamed', component })
    expect(added).toBe(3)
    expect([...live.values()]).toEqual(['Alpha', 'Beta renamed'])
    stop()
    expect(live.size).toBe(0)
  })

  it('tracks thread facet availability at invocation time', () => {
    const registry = createWorkbenchPanelRegistry()
    let thread: string | undefined
    registry.register({
      id: 'facet/cost',
      title: 'Cost source',
      component: () => null,
      threadFacet: {
        kind: 'cost',
        order: 1,
        title: () => 'Cost',
        description: () => 'Thread usage',
        onScreen: { subscribe: () => () => {}, getSnapshot: () => thread },
      },
    })
    const action = workbenchPaletteActions({ registry, existingMainPanelIds: new Set() })[0]
    expect(action?.label).toBe('Cost')
    expect(action?.isAvailable?.(context)).toBe(false)
    action?.run(context)
    expect(registry.takeOpenRequests()).toEqual([])
    thread = 'thread-1'
    expect(action?.isAvailable?.(context)).toBe(true)
    action?.run(context)
    expect(registry.takeOpenRequests()).toEqual(['facet/cost'])
  })
})
