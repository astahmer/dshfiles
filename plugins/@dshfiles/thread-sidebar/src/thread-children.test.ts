import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ThreadChildrenModel, type ThreadNode } from './thread-children.js'

const thread = (id: string, updatedAt: number, parentId?: string): ThreadNode => (parentId === undefined ? { id, updatedAt } : { id, updatedAt, parentId })
const ids = (threads: readonly ThreadNode[] | undefined): string[] => (threads ?? []).map(item => item.id)
test('subagents and their own children fold under the top-most listed ancestor, newest first', () => {
  const tree = ThreadChildrenModel.groupThreadChildren({
    threads: [thread('parent', 10), thread('child-a', 5, 'parent'), thread('grandchild', 9, 'child-a'), thread('solo', 8)],
  })
  assert.deepEqual(ids(tree.roots), ['parent', 'solo'])
  assert.deepEqual(ids(tree.childrenByRoot.get('parent')), ['grandchild', 'child-a'])
})

test('a child whose parent is not listed is detached under that missing ancestor instead of posing as a root row', () => {
  const tree = ThreadChildrenModel.groupThreadChildren({ threads: [thread('orphan', 1, 'missing')] })
  assert.deepEqual(ids(tree.roots), [])
  assert.equal(tree.childrenByRoot.size, 0)
  assert.deepEqual(ids(tree.detachedByMissingAncestor.get('missing')), ['orphan'])
})

test('a branch whose listed ancestor has a missing parent follows it into one detached group', () => {
  const tree = ThreadChildrenModel.groupThreadChildren({
    threads: [thread('kept', 10), thread('detached', 9, 'gone'), thread('nested', 8, 'detached')],
  })
  assert.deepEqual(ids(tree.roots), ['kept'])
  assert.equal(tree.childrenByRoot.size, 0)
  assert.deepEqual(ids(tree.detachedByMissingAncestor.get('gone')), ['detached', 'nested'])
})

test('children stay nested under their parent even when sidebar sections differ', () => {
  const tree = ThreadChildrenModel.groupThreadChildren({
    threads: [
      { ...thread('parent', 1), section: 'active' },
      { ...thread('child', 2, 'parent'), section: 'inactive' },
      { ...thread('archived-child', 3, 'parent'), section: 'archived' },
    ],
  })
  assert.deepEqual(ids(tree.roots), ['parent'])
  assert.deepEqual(ids(tree.childrenByRoot.get('parent')), ['archived-child', 'child'])
})

test('a parent cycle stays bounded', () => {
  const cycle = ThreadChildrenModel.groupThreadChildren({ threads: [thread('a', 1, 'b'), thread('b', 2, 'a')] })
  assert.equal(cycle.roots.length + [...cycle.childrenByRoot.values()].flat().length, 2)
})

test('thread actions include every descendant by default and can be limited to the selected thread', () => {
  const threads = [thread('child', 1, 'parent'), thread('grandchild', 2, 'child'), thread('unrelated', 3)]
  assert.deepEqual(ThreadChildrenModel.threadActionTargetIds({ threadId: 'parent', threads, cascadeToChildren: true }), ['parent', 'child', 'grandchild'])
  assert.deepEqual(ThreadChildrenModel.threadActionTargetIds({ threadId: 'parent', threads, cascadeToChildren: false }), ['parent'])
})

test('thread action targets remain unique when parent links contain a cycle', () => {
  const threads = [thread('child', 1, 'parent'), thread('parent', 2, 'child')]
  assert.deepEqual(ThreadChildrenModel.threadActionTargetIds({ threadId: 'parent', threads, cascadeToChildren: true }), ['parent', 'child'])
})

test('a parent lists every child under it whatever the view filters, minus the children an attention group renders', () => {
  const children = ['live', 'finished', 'waiting'].map(id => ({ id }))
  const listed = (options: { readonly groupedAttentionIds: ReadonlySet<string>; readonly groupByStatus: boolean }): string[] =>
    ThreadChildrenModel.listChildThreads({ children, ...options }).map(child => child.id)
  assert.deepEqual(listed({ groupedAttentionIds: new Set(), groupByStatus: true }), ['live', 'finished', 'waiting'])
  assert.deepEqual(listed({ groupedAttentionIds: new Set(['waiting']), groupByStatus: true }), ['live', 'finished'])
  assert.deepEqual(listed({ groupedAttentionIds: new Set(['waiting']), groupByStatus: false }), ['live', 'finished', 'waiting'])
})

test('children past the limit hide behind a count until every child is shown', () => {
  const children = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const truncated = ThreadChildrenModel.visibleChildren({ children, limit: 3, showAll: false, selectedId: undefined })
  assert.deepEqual(
    truncated.shown.map(child => child.id),
    ['a', 'b', 'c'],
  )
  assert.equal(truncated.hiddenCount, 2)

  const expanded = ThreadChildrenModel.visibleChildren({ children, limit: 3, showAll: true, selectedId: undefined })
  assert.equal(expanded.shown.length, 5)
  assert.equal(expanded.hiddenCount, 0)

  assert.equal(ThreadChildrenModel.visibleChildren({ children: children.slice(0, 3), limit: 3, showAll: false, selectedId: undefined }).hiddenCount, 0)
})

test('the open child stays visible even past the limit', () => {
  const children = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const result = ThreadChildrenModel.visibleChildren({ children, limit: 2, showAll: false, selectedId: 'e' })
  assert.deepEqual(
    result.shown.map(child => child.id),
    ['a', 'b', 'e'],
  )
  assert.equal(result.hiddenCount, 2)
})

const subagents = [
  { id: 'live', running: true },
  { id: 'done-a', running: false },
  { id: 'open-done', running: false },
  { id: 'done-b', running: false },
]
const partition = (mode: 'show' | 'collapse' | 'hide') => {
  const result = ThreadChildrenModel.partitionFinishedChildren({ children: subagents, mode, isFinished: child => !child.running, selectedId: 'open-done' })
  return { live: result.live.map(child => child.id), finished: result.finished.map(child => child.id) }
}

test('collapse keeps live and open subagents listed and folds the finished ones in order', () => {
  assert.deepEqual(partition('collapse'), { live: ['live', 'open-done'], finished: ['done-a', 'done-b'] })
})

test('hide drops finished subagents except the open one, and show leaves every child listed', () => {
  assert.deepEqual(partition('hide'), { live: ['live', 'open-done'], finished: [] })
  assert.deepEqual(partition('show'), { live: ['live', 'done-a', 'open-done', 'done-b'], finished: [] })
})

test('parent groups expand by default only while a subagent is working and respect manual overrides', () => {
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [{ origin: 'subagent', running: true }], override: undefined }), true)
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [{ origin: 'subagent', running: false }], override: undefined }), false)
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [{ origin: 'user', running: true }], override: undefined }), false)
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [], override: undefined }), false)
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [{ origin: 'subagent', running: true }], override: false }), false)
  assert.equal(ThreadChildrenModel.shouldOpenChildThreadList({ children: [{ origin: 'subagent', running: false }], override: true }), true)
})

test('an unchanged child list keeps its array identity instead of being copied', () => {
  const children = [thread('a', 2), thread('b', 1)]
  assert.equal(ThreadChildrenModel.listChildThreads({ children, groupedAttentionIds: new Set(), groupByStatus: true }), children)
  assert.equal(ThreadChildrenModel.listChildThreads({ children, groupedAttentionIds: new Set(['elsewhere']), groupByStatus: true }), children)
  assert.equal(ThreadChildrenModel.listChildThreads({ children, groupedAttentionIds: new Set(['elsewhere']), groupByStatus: false }), children)
  assert.deepEqual(ids(ThreadChildrenModel.listChildThreads({ children, groupedAttentionIds: new Set(['a']), groupByStatus: true })), ['b'])
})

test('nothing finished keeps the child list and one shared empty finished list', () => {
  const children = [thread('a', 2), thread('b', 1)]
  const collapsed = ThreadChildrenModel.partitionFinishedChildren({ children, mode: 'collapse', isFinished: () => false, selectedId: undefined })
  const shown = ThreadChildrenModel.partitionFinishedChildren({ children, mode: 'show', isFinished: () => true, selectedId: undefined })
  const hidden = ThreadChildrenModel.partitionFinishedChildren({ children: [], mode: 'hide', isFinished: () => true, selectedId: undefined })
  assert.equal(collapsed.live, children)
  assert.equal(shown.live, children)
  assert.equal(collapsed.finished, shown.finished)
  assert.equal(shown.finished, hidden.finished)
  assert.deepEqual(ids(collapsed.finished), [])
})

test('the open child stays live while finished ones fold away or disappear', () => {
  const children = [thread('a', 2), thread('b', 1), thread('open', 3)]
  const isFinished = (child: ThreadNode): boolean => child.id !== 'open'
  const collapsed = ThreadChildrenModel.partitionFinishedChildren({ children, mode: 'collapse', isFinished, selectedId: undefined })
  assert.deepEqual(ids(collapsed.live), ['open'])
  assert.deepEqual(ids(collapsed.finished), ['a', 'b'])
  const hidden = ThreadChildrenModel.partitionFinishedChildren({ children, mode: 'hide', isFinished, selectedId: undefined })
  assert.deepEqual(ids(hidden.live), ['open'])
  assert.deepEqual(ids(hidden.finished), [])
  const selectedStaysLive = ThreadChildrenModel.partitionFinishedChildren({ children, mode: 'collapse', isFinished: () => true, selectedId: 'b' })
  assert.deepEqual(ids(selectedStaysLive.live), ['b'])
  assert.deepEqual(ids(selectedStaysLive.finished), ['a', 'open'])
})
