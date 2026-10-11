import assert from 'node:assert/strict'
import { test } from 'vitest'
import { groupThreadChildren, visibleChildren, type ThreadNode } from './thread-children.js'

const thread = (id: string, updatedAt: number, parentId?: string): ThreadNode => (parentId === undefined ? { id, updatedAt } : { id, updatedAt, parentId })
const ids = (threads: readonly ThreadNode[] | undefined): string[] => (threads ?? []).map(item => item.id)
test('subagents and their own children fold under the top-most listed ancestor, newest first', () => {
  const tree = groupThreadChildren({ threads: [thread('parent', 10), thread('child-a', 5, 'parent'), thread('grandchild', 9, 'child-a'), thread('solo', 8)] })
  assert.deepEqual(ids(tree.roots), ['parent', 'solo'])
  assert.deepEqual(ids(tree.childrenByRoot.get('parent')), ['grandchild', 'child-a'])
})

test('a child whose parent is not listed stays its own row', () => {
  const tree = groupThreadChildren({ threads: [thread('orphan', 1, 'missing')] })
  assert.deepEqual(ids(tree.roots), ['orphan'])
  assert.equal(tree.childrenByRoot.size, 0)
})

test('children stay nested under their parent even when sidebar sections differ', () => {
  const tree = groupThreadChildren({
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
  const cycle = groupThreadChildren({ threads: [thread('a', 1, 'b'), thread('b', 2, 'a')] })
  assert.equal(cycle.roots.length + [...cycle.childrenByRoot.values()].flat().length, 2)
})

test('children past the limit hide behind a count until every child is shown', () => {
  const children = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const truncated = visibleChildren({ children, limit: 3, showAll: false, selectedId: undefined })
  assert.deepEqual(truncated.shown.map(child => child.id), ['a', 'b', 'c'])
  assert.equal(truncated.hiddenCount, 2)

  const expanded = visibleChildren({ children, limit: 3, showAll: true, selectedId: undefined })
  assert.equal(expanded.shown.length, 5)
  assert.equal(expanded.hiddenCount, 0)

  assert.equal(visibleChildren({ children: children.slice(0, 3), limit: 3, showAll: false, selectedId: undefined }).hiddenCount, 0)
})

test('the open child stays visible even past the limit', () => {
  const children = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const result = visibleChildren({ children, limit: 2, showAll: false, selectedId: 'e' })
  assert.deepEqual(result.shown.map(child => child.id), ['a', 'b', 'e'])
  assert.equal(result.hiddenCount, 2)
})
