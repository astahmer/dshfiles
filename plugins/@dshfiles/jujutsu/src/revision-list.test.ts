import { describe, expect, it } from 'vitest'
import type { RevisionGraphRow } from './graph.ts'
import { RevisionListModel } from './revision-list.ts'

const layout = (commitId: string, lane = 0): RevisionGraphRow => ({
  commitId,
  commitLane: lane,
  color: 0,
  laneCount: 1,
  incoming: [],
  passing: [],
  outgoing: [],
  topLanes: [],
  bottomLanes: [],
})
const layouts = new Map(['a', 'b', 'c'].map(id => [id, layout(id)]))

describe('remoteBookmarkRevision', () => {
  it('finds the selected bookmark on the selected remote only', () => {
    const revisions = [
      { commitId: 'a', bookmarks: ['main@origin'] },
      { commitId: 'b', bookmarks: ['main@upstream'] },
    ]
    expect(RevisionListModel.remoteBookmarkRevision({ revisions, bookmark: 'main', remote: 'origin' })?.commitId).toBe('a')
    expect(RevisionListModel.remoteBookmarkRevision({ revisions, bookmark: 'feature', remote: 'origin' })).toBeUndefined()
  })
})

describe('flattenRevisionGroups', () => {
  it('interleaves day headings with their laid-out revisions', () => {
    const items = RevisionListModel.flattenRevisionGroups({
      groups: [
        { day: 'Today', rows: [{ commitId: 'a' }, { commitId: 'b' }] },
        { day: 'Yesterday', rows: [{ commitId: 'c' }] },
      ],
      collapsedDays: new Set(),
      layouts,
    })
    expect(items.map(item => item.key)).toEqual(['day:Today', 'a', 'b', 'day:Yesterday', 'c'])
    expect(items[0]).toMatchObject({ kind: 'day', count: 2, firstLayout: { commitId: 'a' } })
  })

  it('marks the remote bookmark revision as the pushed boundary', () => {
    const items = RevisionListModel.flattenRevisionGroups({
      groups: [{ day: 'Today', rows: [{ commitId: 'a' }, { commitId: 'b' }] }],
      collapsedDays: new Set(),
      layouts,
      pushBoundary: { commitId: 'b', bookmark: 'main', remote: 'origin' },
    })
    expect(items.map(item => item.key)).toEqual(['day:Today', 'a', 'push:main@origin', 'b'])
    expect(items[2]).toMatchObject({ kind: 'push', bookmark: 'main', remote: 'origin', firstLayout: { commitId: 'b' } })
  })

  it('keeps a collapsed day heading and hides only its rows', () => {
    const items = RevisionListModel.flattenRevisionGroups({
      groups: [
        { day: 'Today', rows: [{ commitId: 'a' }] },
        { day: 'Yesterday', rows: [{ commitId: 'c' }] },
      ],
      collapsedDays: new Set(['Today']),
      layouts,
    })
    expect(items.map(item => item.key)).toEqual(['day:Today', 'day:Yesterday', 'c'])
  })

  it('gives a day that heads several runs a distinct key per run', () => {
    const items = RevisionListModel.flattenRevisionGroups({
      groups: [
        { day: 'Today', rows: [{ commitId: 'a' }] },
        { day: 'Yesterday', rows: [{ commitId: 'b' }] },
        { day: 'Today', rows: [{ commitId: 'c' }] },
      ],
      collapsedDays: new Set(),
      layouts,
    })
    expect(items.map(item => item.key)).toEqual(['day:Today', 'a', 'day:Yesterday', 'b', 'day:Today#1', 'c'])
  })

  it('omits headings without date grouping and skips rows missing from the graph', () => {
    const items = RevisionListModel.flattenRevisionGroups({
      groups: [{ day: '', rows: [{ commitId: 'a' }, { commitId: 'hidden' }] }],
      collapsedDays: new Set(),
      layouts,
    })
    expect(items.map(item => item.key)).toEqual(['a'])
  })
})

describe('activeDayIndex', () => {
  const items = [{ kind: 'day' }, { kind: 'revision' }, { kind: 'revision' }, { kind: 'day' }, { kind: 'revision' }] as const

  it('picks the nearest heading at or above the first visible row', () => {
    expect(RevisionListModel.activeDayIndex(items, 0)).toBe(0)
    expect(RevisionListModel.activeDayIndex(items, 2)).toBe(0)
    expect(RevisionListModel.activeDayIndex(items, 4)).toBe(3)
    expect(RevisionListModel.activeDayIndex(items, 99)).toBe(3)
  })

  it('has no sticky heading without date grouping', () => {
    expect(RevisionListModel.activeDayIndex([{ kind: 'revision' }], 0)).toBeNull()
  })
})
