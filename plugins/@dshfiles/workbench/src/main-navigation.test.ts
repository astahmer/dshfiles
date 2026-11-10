import { describe, expect, it } from 'vitest'
import { createMainNavigation } from './main-navigation.js'
import type { WorkbenchPanelDefinition } from './registry.js'
import type { WorkbenchTabsProvider, WorkbenchTabsSnapshot } from './tabs.js'

const definition: WorkbenchPanelDefinition = { id: 'main/traces', mainPanelId: 'traces', title: 'Traces', component: () => null }
const fixture = () => {
  let workbench = true
  let snapshot: WorkbenchTabsSnapshot = { enabled: true, scopeKey: 'one', activeTabId: null, tabs: [] }
  const listeners = new Set<() => void>()
  const registryListeners = new Set<() => void>()
  const registered = new Map<string, WorkbenchPanelDefinition>()
  const revealed: string[] = []
  const requested: string[] = []
  const tabs: WorkbenchTabsProvider = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    renderStart: () => null,
    actions: {
      activate: id => {
        snapshot = { ...snapshot, activeTabId: id }
      },
      close: () => {},
      keep: () => {},
      togglePin: () => {},
      move: () => {},
      closeOthers: () => {},
      closeToRight: () => {},
      moveAside: () => false,
      open: () => {},
      newTab: () => {},
      renameThread: async () => {},
    },
  }
  const navigation = createMainNavigation({
    isWorkbench: () => workbench,
    definition: id => (id === 'traces' ? definition : undefined),
    definitionForTab: id => registered.get(id),
    tabs: () => tabs,
    subscribeRegistry: listener => {
      registryListeners.add(listener)
      return () => {
        registryListeners.delete(listener)
      }
    },
    requestSemantic: id => {
      requested.push(id)
    },
    reveal: id => {
      revealed.push(id)
    },
  })
  return {
    navigation,
    revealed,
    requested,
    native: () => {
      workbench = false
    },
    nonsemantic: () => {
      snapshot = { ...snapshot, enabled: false }
    },
    addTab: (id: string) => {
      snapshot = {
        ...snapshot,
        activeTabId: id,
        tabs: [
          {
            id,
            title: 'Traces',
            kind: 'panel',
            panelId: 'traces',
            target: { kind: 'panel', panelId: 'traces' },
            active: true,
            pinned: false,
            preview: false,
            available: true,
            status: null,
          },
        ],
      }
      for (const listener of listeners) listener()
    },
    register: (tabId: string, panelId: string) => {
      registered.set(tabId, { ...definition, id: panelId, tabId })
      for (const listener of registryListeners) listener()
    },
  }
}

describe('main panel navigation', () => {
  it('distinguishes native and nonsemantic Workbench occurrences', async () => {
    const panel = fixture()
    panel.native()
    expect(await panel.navigation.open('traces')).toEqual({ kind: 'native' })
    const dock = fixture()
    dock.nonsemantic()
    expect(await dock.navigation.open('traces')).toEqual({ kind: 'workbench', panelId: 'main/traces' })
    expect(dock.revealed).toEqual(['main/traces'])
  })
  it('cancels unresolved navigation when the owner is disposed', async () => {
    const panel = fixture()
    const opening = panel.navigation.open('traces')
    panel.navigation.dispose()
    await expect(opening).rejects.toThrow('navigation cancelled')
    expect(panel.revealed).toEqual([])
  })
  it('waits for the actual semantic occurrence to register', async () => {
    const panel = fixture()
    const opening = panel.navigation.open('traces')
    expect(panel.requested).toEqual(['traces'])
    panel.addTab('actor-tab')
    expect(panel.revealed).toEqual([])
    panel.register('actor-tab', 'tab/actor-tab')
    expect(await opening).toEqual({ kind: 'workbench', panelId: 'tab/actor-tab' })
    expect(panel.revealed).toEqual(['tab/actor-tab'])
  })
})
