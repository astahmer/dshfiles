import { describe, expect, it } from 'vitest'
import type { Revision } from './api.js'
import { RevisionGraphModel } from './graph.js'
import { ReferenceGraphModel } from './reference-graph.js'

const id = (name: string) => name.padEnd(40, '0').replace(/[^0-9a-f]/g, 'a')

const revision = (name: string, parents: readonly string[]): Revision => ({
  commitId: id(name),
  changeId: id(name).slice(0, 32),
  shortestChangeId: name,
  description: `describe ${name}`,
  author: 'someone',
  authorTime: '2026-11-03T00:00:00Z',
  parents: parents.map(id),
  bookmarks: [],
  localBookmarks: [],
  remoteBookmarksText: '',
  tags: [],
  workspaces: [],
  workingCopy: false,
  mine: true,
  immutable: false,
  divergent: false,
  empty: false,
  conflict: false,
  evolved: false,
  changeOffset: 0,
})

const layout = (revisions: readonly Revision[], listedCommitIds: readonly string[]) => {
  const byId = new Map(revisions.map(item => [item.commitId, item]))
  const listed = listedCommitIds.flatMap(commitId => byId.get(commitId) ?? [])
  return RevisionGraphModel.layoutRevisionGraph(listed, byId, false)
}

describe('ReferenceGraphModel.collapseHidden', () => {
  it('keeps the preview layout while sending one stand-in per hidden stretch', () => {
    // top -> h1 -> h2 -> merge(h3, base);  h3 -> h4 -> base;  side -> base;  base -> r1 -> root
    const revisions = [
      revision('f1', ['b1']),
      revision('b1', ['b2']),
      revision('b2', ['c3', 'ba5e']),
      revision('c3', ['c4']),
      revision('c4', ['ba5e']),
      revision('5ide', ['ba5e']),
      revision('ba5e', ['d1']),
      revision('d1', ['e00']),
      revision('e00', []),
    ]
    const listedCommitIds = ['f1', '5ide', 'ba5e'].map(id)
    const collapsed = ReferenceGraphModel.collapseHidden({ revisions, listedCommitIds })
    expect(collapsed.length).toBeLessThan(revisions.length)
    expect(layout(collapsed, listedCommitIds)).toEqual(layout(revisions, listedCommitIds))
    expect(collapsed.filter(item => !listedCommitIds.includes(item.commitId)).every(item => item.description === '')).toBe(true)
  })
})
