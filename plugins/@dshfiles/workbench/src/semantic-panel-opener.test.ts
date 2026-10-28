import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchRegionId } from './dock-regions.js'
import { createSemanticPanelOpener } from './semantic-panel-opener.js'
import { tabPanelId } from './tab-panels.js'
import type { WorkbenchTabsProvider, WorkbenchTabsSnapshot } from './tabs.js'

const fixture = () => {
  let snapshot: WorkbenchTabsSnapshot = { enabled: true, scopeKey: 'project:a', activeTabId: null, tabs: [] }
  const openTab = vi.fn()
  const registered = new Set<string>()
  const saved = new Map<string, WorkbenchRegionId>()
  const openInRegion = vi.fn()
  const tabs: WorkbenchTabsProvider = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    renderStart: () => null,
    actions: {
      activate: vi.fn(),
      close: vi.fn(),
      keep: vi.fn(),
      togglePin: vi.fn(),
      move: vi.fn(),
      closeOthers: vi.fn(),
      closeToRight: vi.fn(),
      moveAside: () => false,
      open: openTab,
      newTab: vi.fn(),
      renameThread: async () => undefined,
    },
  }
  const opener = createSemanticPanelOpener({ tabs: () => tabs, registered: id => registered.has(id), savedRegionOf: id => saved.get(id), openInRegion })
  return {
    opener,
    registered,
    saved,
    openInRegion,
    openTab,
    update: (patch: Partial<WorkbenchTabsSnapshot>) => {
      snapshot = { ...snapshot, ...patch }
    },
  }
}

describe('semantic Add-panel placement', () => {
  it('retains a nested target through delayed semantic registration and consumes that intent once', () => {
    const panel = fixture()
    const id = tabPanelId('panel:jujutsu')
    panel.opener.request('nested/main/a', 'jujutsu', 'Jujutsu')
    expect(panel.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'panel', panelId: 'jujutsu' }, true, 'Jujutsu')
    expect(panel.openInRegion).not.toHaveBeenCalled()
    panel.registered.add(id)
    panel.opener.place(id)
    expect(panel.openInRegion).toHaveBeenLastCalledWith('nested/main/a', id)
    panel.saved.set(id, 'bottom')
    panel.opener.place(id)
    expect(panel.openInRegion).toHaveBeenLastCalledWith('bottom', id)
    expect(panel.openTab).toHaveBeenCalledTimes(1)
  })

  it('moves an existing occurrence even when reopening the actor tab publishes no changed snapshot', () => {
    const panel = fixture()
    const id = tabPanelId('panel:jujutsu')
    panel.registered.add(id)
    panel.saved.set(id, 'main')
    panel.opener.request('nested/main/a', 'jujutsu', 'Jujutsu')
    expect(panel.openInRegion).toHaveBeenCalledExactlyOnceWith('nested/main/a', id)
    expect(panel.openTab).toHaveBeenCalledTimes(1)
  })

  it('uses the latest explicit target and never applies a delayed intent to another project', () => {
    const panel = fixture()
    const id = tabPanelId('panel:jujutsu')
    panel.opener.request('right', 'jujutsu', 'Jujutsu')
    panel.opener.request('nested/main/a', 'jujutsu', 'Jujutsu')
    panel.opener.place(id)
    expect(panel.openInRegion).toHaveBeenLastCalledWith('nested/main/a', id)
    panel.opener.request('right', 'jujutsu', 'Jujutsu')
    panel.update({ scopeKey: 'project:b' })
    panel.opener.place(id)
    expect(panel.openInRegion).toHaveBeenLastCalledWith('main', id)
  })

  it('does not create disabled semantic tabs or turn sidebar adoption into another actor navigation', () => {
    const panel = fixture()
    const id = tabPanelId('panel:jujutsu')
    panel.update({ enabled: false })
    panel.opener.request('nested/main/a', 'jujutsu', 'Jujutsu')
    expect(panel.openInRegion).not.toHaveBeenCalled()
    expect(panel.openTab).not.toHaveBeenCalled()
    panel.update({ enabled: true })
    panel.saved.set(id, 'right')
    panel.opener.place(id)
    expect(panel.openInRegion).toHaveBeenCalledExactlyOnceWith('right', id)
    expect(panel.openTab).not.toHaveBeenCalled()
  })
})
