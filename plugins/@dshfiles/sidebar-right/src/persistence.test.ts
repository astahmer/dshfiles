import { brandString } from '@deepseek-ai/dsh-brand'
import { EMPTY_HISTORY, type LayoutState, type PaneId, type TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { beforeEach, describe, expect, it } from 'vitest'
import { SidebarLayoutStorage } from './native/client/persistence.ts'

const sessionId = 'session-persisted'
const storageKey = `${SidebarLayoutStorage.prefix}.${sessionId}`
const paneId = brandString<PaneId>('pane1')
const tabId = brandString<TabId>('tab1')

const layout: LayoutState = {
  nodes: { [paneId]: { kind: 'pane', id: paneId, host: 'dock', tabs: [tabId], activeTabId: tabId, rect: undefined } },
  tabs: { [tabId]: { id: tabId, kind: 'file', contentId: 'file:src/a.ts', title: 'a.ts' } },
  rootId: paneId,
  floats: [],
  activePaneId: paneId,
  expanded: false,
  mode: 'push',
}

const persist = (surface: unknown): void => {
  localStorage.setItem(storageKey, JSON.stringify({ bySession: { [sessionId]: surface } }))
}

beforeEach(() => {
  localStorage.clear()
})

describe('sidebar layout persistence', () => {
  it('round-trips the current surface with a fresh undo history', () => {
    SidebarLayoutStorage.write(sessionId, { layout, minted: 1, history: EMPTY_HISTORY })
    expect(SidebarLayoutStorage.read(sessionId)).toEqual({ layout, minted: 1, history: EMPTY_HISTORY })
  })

  it('ignores properties the stored layout does not declare', () => {
    persist({ layout: { ...layout, expanded: false, dragState: { pane: 'pane1' } }, minted: 1, savedAt: 42 })
    expect(SidebarLayoutStorage.read(sessionId)).toEqual({ layout, minted: 1, history: EMPTY_HISTORY })
  })

  it('rejects and clears a saved node key that names no pane or split', () => {
    persist({ layout: { ...layout, nodes: { bogus: layout.nodes[paneId] } }, minted: 1 })
    expect(SidebarLayoutStorage.read(sessionId)).toBeUndefined()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('rejects and clears a pane with a non-positive rectangle', () => {
    const floated = { ...layout.nodes[paneId], host: 'float', rect: { x: 0, y: 0, width: 0, height: 240 } }
    persist({ layout: { ...layout, nodes: { [paneId]: floated }, floats: [paneId] }, minted: 1 })
    expect(SidebarLayoutStorage.read(sessionId)).toBeUndefined()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('rejects and clears a split whose sizes do not fill the axis', () => {
    const floatedTab = brandString<TabId>('tab2')
    const secondPane = brandString<PaneId>('pane2')
    persist({
      layout: {
        nodes: {
          [paneId]: { kind: 'pane', id: paneId, host: 'dock', tabs: [tabId], activeTabId: tabId },
          [secondPane]: { kind: 'pane', id: secondPane, host: 'dock', tabs: [floatedTab], activeTabId: floatedTab },
          split1: { kind: 'split', id: 'split1', axis: 'row', children: [paneId, secondPane], sizes: [0.5, 0.4] },
        },
        tabs: {
          [tabId]: layout.tabs[tabId],
          [floatedTab]: { id: floatedTab, kind: 'file', contentId: 'file:src/b.ts', title: 'b.ts' },
        },
        rootId: 'split1',
        floats: [],
        activePaneId: paneId,
        expanded: false,
        mode: 'push',
      },
      minted: 2,
    })
    expect(SidebarLayoutStorage.read(sessionId)).toBeUndefined()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('rejects and clears a non-integer mint counter', () => {
    persist({ layout, minted: 1.5 })
    expect(SidebarLayoutStorage.read(sessionId)).toBeUndefined()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('reads nothing when the session has no saved layout', () => {
    persist({ layout, minted: 1 })
    expect(SidebarLayoutStorage.read('session-other')).toBeUndefined()
    expect(localStorage.getItem(storageKey)).not.toBeNull()
  })
})
