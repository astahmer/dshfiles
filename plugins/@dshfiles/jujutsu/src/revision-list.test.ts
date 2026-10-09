import { describe, expect, it } from 'vitest'
import { activeDayIndex, flattenRevisionGroups } from './revision-list.ts'

const layout = (commitId: string, lane = 0) => ({ commitId, commitLane: lane, incoming: false, laneCount: 1, topLanes: [], bottomLanes: [], edges: [] })
const layouts = new Map(['a', 'b', 'c'].map(id => [id, layout(id)]))

describe('flattenRevisionGroups', () => {
  it('interleaves day headings with their laid-out revisions', () => {
    const items = flattenRevisionGroups({
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

  it('keeps a collapsed day heading and hides only its rows', () => {
    const items = flattenRevisionGroups({
      groups: [
        { day: 'Today', rows: [{ commitId: 'a' }] },
        { day: 'Yesterday', rows: [{ commitId: 'c' }] },
      ],
      collapsedDays: new Set(['Today']),
      layouts,
    })
    expect(items.map(item => item.key)).toEqual(['day:Today', 'day:Yesterday', 'c'])
  })

  it('omits headings without date grouping and skips rows missing from the graph', () => {
    const items = flattenRevisionGroups({ groups: [{ day: '', rows: [{ commitId: 'a' }, { commitId: 'hidden' }] }], collapsedDays: new Set(), layouts })
    expect(items.map(item => item.key)).toEqual(['a'])
  })
})

describe('activeDayIndex', () => {
  const items = [{ kind: 'day' }, { kind: 'revision' }, { kind: 'revision' }, { kind: 'day' }, { kind: 'revision' }] as const

  it('picks the nearest heading at or above the first visible row', () => {
    expect(activeDayIndex(items, 0)).toBe(0)
    expect(activeDayIndex(items, 2)).toBe(0)
    expect(activeDayIndex(items, 4)).toBe(3)
    expect(activeDayIndex(items, 99)).toBe(3)
  })

  it('has no sticky heading without date grouping', () => {
    expect(activeDayIndex([{ kind: 'revision' }], 0)).toBeNull()
  })
})
