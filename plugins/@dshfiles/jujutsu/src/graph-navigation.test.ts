import { describe, expect, it } from 'vitest'
import type { Revision } from './api.js'
import { filterGraphRevisions, mergeGraphRevisions, relationshipLabel, type GraphFilters } from './graph-navigation.js'
import { layoutRevisionGraph } from './graph.js'
import { resolveGraphSelection } from './graph-selection.js'

const revision = (commitId: string, parents: string[] = [], overrides: Partial<Revision> = {}): Revision => ({
  commitId,
  parents,
  changeId: commitId,
  shortestChangeId: commitId,
  description: commitId,
  author: 'Person',
  authorTime: '2026-10-15T12:00:00Z',
  bookmarks: [],
  localBookmarks: [],
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
  ...overrides,
})
const filters = (overrides: Partial<GraphFilters> = {}): GraphFilters => ({
  mineOnly: false,
  hideImmutable: false,
  author: '',
  text: '',
  fromDate: '',
  toDate: '',
  view: null,
  hidden: [],
  revealed: new Set(),
  ...overrides,
})

describe('graph navigation projection', () => {
  it('preserves shared merge ancestry when supplied exclusive history is hidden', () => {
    const revisions = [revision('a', ['shared']), revision('b', ['shared']), revision('shared', ['root']), revision('root')]
    const result = filterGraphRevisions(revisions, filters({ hidden: [{ commitId: 'a', label: 'a', commitIds: ['a'], truncated: false }] }))
    expect(result.map(row => row.commitId)).toEqual(['b', 'shared', 'root'])
  })
  it('explicit temporary reveal overrides every filter without modifying filter intent', () => {
    const target = revision('target', [], { mine: false, immutable: true })
    const intent = filters({
      mineOnly: true,
      hideImmutable: true,
      author: 'Other',
      text: 'no match',
      fromDate: '2027-01-01',
      toDate: '2020-01-01',
      hidden: [{ commitId: 'target', label: 'target', commitIds: ['target'], truncated: false }],
      view: { kind: 'history', label: 'History', commitIds: new Set(), revisions: [], truncated: false },
      revealed: new Set(['target']),
    })
    expect(filterGraphRevisions([target], intent)).toEqual([target])
    expect(filterGraphRevisions([target], { ...intent, revealed: new Set() })).toEqual([])
    expect(intent.mineOnly).toBe(true)
  })
  it('merges outside-page landmarks by exact commit ID without collapsing divergent copies', () => {
    const original = revision('one')
    const divergent = revision('two', [], { changeId: 'one' })
    const updated = { ...original, description: 'updated' }
    expect(mergeGraphRevisions([original], [divergent, updated])).toEqual([updated, divergent])
  })
  it('filters search before layout so omitted parents become honest dashed bridges', () => {
    const revisions = [revision('tip', ['middle'], { description: 'match' }), revision('middle', ['root']), revision('root', [], { description: 'match' })]
    const projection = filterGraphRevisions(revisions, filters({ text: 'match' }))
    const rows = layoutRevisionGraph(projection, new Map(revisions.map(row => [row.commitId, row])), false)
    expect(rows.map(row => row.commitId)).toEqual(['tip', 'root'])
    expect(rows[0]?.outgoing.some(link => link.dashed)).toBe(true)
  })
  it('keeps all parents of a connection supplied by the Host, never first-parent only', () => {
    const revisions = [revision('merge', ['left', 'right']), revision('left', ['root']), revision('right', ['root']), revision('root'), revision('noise')]
    const projection = filterGraphRevisions(
      revisions,
      filters({ view: { kind: 'connection', label: 'Connection', commitIds: new Set(['merge', 'left', 'right', 'root']), revisions: [], truncated: false } }),
    )
    expect(projection.map(row => row.commitId)).toEqual(['merge', 'left', 'right', 'root'])
  })
  it('compares the displayed rewritten selection, never stale captured metadata', () => {
    const old = revision('old')
    const rewritten = revision('new', [], { changeId: old.changeId })
    expect(resolveGraphSelection({ selection: old, revisions: [rewritten], extraRevisions: [old] })).toBe(rewritten)
    expect(resolveGraphSelection({ selection: old, revisions: [], extraRevisions: [old] })).toBe(old)
    expect(
      resolveGraphSelection({ selection: old, revisions: [rewritten, revision('divergent', [], { changeId: old.changeId })], extraRevisions: [old] }),
    ).toBeUndefined()
  })
  it('keeps a zero selected-only view empty instead of adding target-side context', () => {
    const revisions = [revision('target', ['selected']), revision('selected')]
    expect(
      filterGraphRevisions(revisions, filters({ view: { kind: 'difference', label: 'Selected-only', commitIds: new Set(), revisions, truncated: false } })),
    ).toEqual([])
  })
  it('labels relationship direction explicitly', () => {
    expect(relationshipLabel('ancestor')).toBe('Behind target')
    expect(relationshipLabel('descendant')).toBe('Ahead of target')
    expect(relationshipLabel('same')).toBe('Same revision')
    expect(relationshipLabel('no-common-ancestor')).toBe('Unrelated histories')
  })
})
