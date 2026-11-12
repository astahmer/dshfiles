import { describe, expect, it } from 'vitest'
import { SidebarCatalog } from './sidebar-catalog.js'

const none = (): null => null

describe('SidebarCatalog (b:952m)', () => {
  it('lists pages, thread facets and addable views once, leaving out occurrences, choosers and the sidebar’s own panes', () => {
    const panels = SidebarCatalog.catalog({
      pages: [
        { id: 'traces', label: 'Traces: Spans', order: 1 },
        { id: 'stray', label: 'Plugin: Stray page', order: 2 },
      ],
      sections: [{ panelId: 'traces', destination: 'observe', label: 'Traces' }],
      views: [
        { id: 'traces-view', title: 'Traces', component: none, mainPanelId: 'traces' },
        { id: 'dshfiles-changes', title: 'Changes', component: none, threadFacet: { kind: 'changes', order: 1, title: () => 'Changes' } },
        { id: 'dshfiles-editor.main', title: 'Editor: Files', component: none },
        { id: 'resource', title: 'Resource', component: none, hiddenFromAdd: true },
        { id: 'tab-1', title: 'Thread', component: none, tabId: 'tab-1' },
        { id: 'chooser', title: 'New tab', component: none, newView: true },
        { id: 'dshfiles-thread-sidebar.workbench-sidebar', title: 'Sidebar', component: none },
      ],
    })
    expect(panels).toEqual([
      { id: 'traces', title: 'Traces', kind: 'page' },
      { id: 'stray', title: 'Stray page', kind: 'page' },
      { id: 'dshfiles-changes', title: 'Changes', kind: 'facet' },
      { id: 'dshfiles-editor.main', title: 'Files', kind: 'view' },
    ])
    expect(SidebarCatalog.key(panels)).toBe(SidebarCatalog.key([...panels].reverse()))
  })
})
