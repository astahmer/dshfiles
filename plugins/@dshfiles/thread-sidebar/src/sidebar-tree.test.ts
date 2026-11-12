import { describe, expect, it } from 'vitest'
import { EMPTY_SIDEBAR_TREE, SidebarTreeModel, SidebarTrees, type MappedSection, type SidebarPanel, type SidebarTree } from './sidebar-tree.js'

const sections: readonly MappedSection[] = [
  { panelId: 'dshfiles-thread-board', destination: 'threads', label: 'Board', unmapped: false },
  { panelId: 'usage', destination: 'observe', label: 'Usage', description: 'Cost and quota.', unmapped: false },
  { panelId: 'traces', destination: 'observe', label: 'Traces', unmapped: false },
  { panelId: 'stray', destination: 'settings', label: 'Stray', unmapped: true },
]
const panels: readonly SidebarPanel[] = [{ id: 'dshfiles-changes', title: 'Changes', kind: 'facet' }]

const treeOf = (change: (tree: SidebarTree) => SidebarTree): SidebarTree => change(EMPTY_SIDEBAR_TREE)
const unwrap = (result: ReturnType<typeof SidebarTreeModel.addPanel>): SidebarTree => {
  if (!result.ok) throw new Error(result.refusal.reason)
  return result.tree
}

describe('SidebarTrees.resolve (b:952m)', () => {
  it('derives the eight built-in folders in rail order with every page in its mapped folder', () => {
    const folders = SidebarTrees.resolve({ tree: EMPTY_SIDEBAR_TREE, sections, panels })
    expect(folders.map(folder => folder.id)).toEqual(['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge', 'settings'])
    expect(folders.find(folder => folder.id === 'observe')?.entries.map(entry => [entry.viewId, entry.mapped])).toEqual([
      ['usage', true],
      ['traces', true],
    ])
    expect(folders.find(folder => folder.id === 'settings')?.entries).toMatchObject([{ viewId: 'stray', unmapped: true }])
  })

  it('shows a filed panel only in its folder, skips a removed page, and keeps a page a plugin adds later', () => {
    const created = SidebarTreeModel.createFolder(EMPTY_SIDEBAR_TREE, { title: 'Review' }, 0)
    if (!created.result.ok) throw new Error('create refused')
    let tree = unwrap(SidebarTreeModel.addPanel(created.result.tree, { viewId: 'traces', folderId: 'review' }, 0))
    tree = unwrap(SidebarTreeModel.addPanel(tree, { viewId: 'dshfiles-changes', folderId: 'review', keep: true }, 0))
    tree = unwrap(SidebarTreeModel.removePanel(tree, { viewId: 'usage' }, 0, true))
    const later = [...sections, { panelId: 'new-page', destination: 'observe', label: 'New page', unmapped: false } as const]
    const folders = SidebarTrees.resolve({ tree, sections: later, panels })
    expect(folders.find(folder => folder.id === 'review')?.entries.map(entry => [entry.viewId, entry.title, entry.kind, entry.keep])).toEqual([
      ['traces', 'Traces', 'page', false],
      ['dshfiles-changes', 'Changes', 'facet', true],
    ])
    expect(folders.find(folder => folder.id === 'observe')?.entries.map(entry => entry.viewId)).toEqual(['new-page'])
    expect(SidebarTrees.folderOf(folders, 'traces')?.id).toBe('review')
  })

  it('skips a filed panel this browser cannot show without dropping it from the tree', () => {
    const tree = treeOf(empty => unwrap(SidebarTreeModel.addPanel(empty, { viewId: 'missing-plugin.view', folderId: 'work' }, 0)))
    const folders = SidebarTrees.resolve({ tree, sections, panels })
    expect(folders.find(folder => folder.id === 'work')?.entries).toEqual([])
    expect(tree.folders.find(folder => folder.id === 'work')?.entries).toEqual([{ viewId: 'missing-plugin.view', keep: false }])
  })

  it('normalizes a hand-edited tree: built-ins restored in place, a view filed twice kept once', () => {
    const tree = SidebarTreeModel.normalize(
      {
        revision: 3,
        folders: [
          { id: 'review', title: 'Review', icon: 'folder', builtIn: false, hidden: true, entries: [{ viewId: 'a', keep: false }] },
          { id: 'settings', title: 'Settings', icon: 'settings', builtIn: true, hidden: false, entries: [{ viewId: 'a', keep: true }] },
        ],
        removed: ['a'],
        tombstones: [],
      },
      0,
    )
    expect(tree.folders.map(folder => folder.id)).toEqual(['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge', 'review', 'settings'])
    expect(tree.folders.find(folder => folder.id === 'review')?.hidden).toBe(false)
    expect(tree.folders.find(folder => folder.id === 'settings')?.entries).toEqual([])
    expect(tree.removed).toEqual([])
  })
})
