import { describe, expect, it } from 'vitest'
import type { RevisionReview } from './api.js'
import { ReviewGraphModel } from './review-graph.js'

const revision = (commitId: string, extra: Partial<RevisionReview> = {}): RevisionReview => ({
  changeId: `${commitId}zzzzzzzzzz`,
  shortChangeId: commitId,
  commitId,
  description: `change ${commitId}`,
  patch: '',
  truncated: false,
  fileCount: 0,
  additions: 0,
  deletions: 0,
  files: [],
  ...extra,
})

describe('review graph', () => {
  it('lists newest first, links across a gap with one dashed edge, and ends on the base', () => {
    const main = { commitId: 'm', shortChangeId: 'mm', bookmarks: ['main'] }
    const rows = ReviewGraphModel.entries([
      revision('a', { links: [], base: [main] }),
      revision('b', { links: [{ commitId: 'a', hidden: 0 }], base: [] }),
      revision('d', { links: [{ commitId: 'b', hidden: 2 }], base: [] }),
    ])
    expect(rows.map(row => (row.kind === 'revision' ? row.revision.commitId : `base:${row.base.commitId}`))).toEqual(['d', 'b', 'a', 'base:m'])
    const top = rows[0]
    expect(top?.kind === 'revision' ? top.hiddenBelow : -1).toBe(2)
    expect(top?.layout.outgoing.some(link => link.dashed)).toBe(true)
    const middle = rows[1]
    expect(middle?.layout.outgoing.some(link => link.dashed)).toBe(false)
    expect(rows.at(-1)?.node.bookmarks).toEqual(['main'])
  })

  it('stands rows unconnected when an older Host sent no links', () => {
    const rows = ReviewGraphModel.entries([revision('a'), revision('b')])
    expect(rows.map(row => row.layout.commitId)).toEqual(['b', 'a'])
    expect(rows.every(row => row.layout.outgoing.length === 0)).toBe(true)
  })

  it("names jj's root commit as a base", () => {
    expect(ReviewGraphModel.isRoot({ commitId: '0'.repeat(40) })).toBe(true)
    expect(ReviewGraphModel.isRoot({ commitId: '0a'.repeat(20) })).toBe(false)
  })

  it('splits the change id at its shortest unique prefix', () => {
    expect(ReviewGraphModel.changeIdParts({ changeId: 'kztxmopoovqw', shortChangeId: 'kz' })).toEqual({ prefix: 'kz', rest: 'txmopo' })
  })
})
