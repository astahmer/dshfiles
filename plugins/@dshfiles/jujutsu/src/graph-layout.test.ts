import { describe, expect, test } from 'vitest'
import type { Revision } from './api.ts'
import { RevisionGraphModel, type GraphLink, type RevisionGraphRow } from './graph.ts'

type FixtureRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable' | 'bookmarks'>

const revision = (commitId: string, parents: readonly string[], options: Partial<FixtureRevision> = {}): FixtureRevision => ({
  commitId,
  parents: [...parents],
  shortestChangeId: commitId,
  immutable: false,
  bookmarks: [],
  ...options,
})

/** A linear chain `prefix0` (top) … `prefix{count-1}`, whose last revision sits on `base`. */
const chain = (prefix: string, count: number, base: string | undefined, options: (index: number) => Partial<FixtureRevision> = () => ({})): FixtureRevision[] =>
  Array.from({ length: count }, (_, index) => {
    const parent = index + 1 < count ? `${prefix}${index + 1}` : base
    return revision(`${prefix}${index}`, parent === undefined ? [] : [parent], options(index))
  })

const layout = (revisions: readonly FixtureRevision[], hideImmutable = false, all: readonly FixtureRevision[] = revisions): readonly RevisionGraphRow[] =>
  RevisionGraphModel.layoutRevisionGraph(revisions, new Map(all.map(row => [row.commitId, row])), hideImmutable)

const ids = (rows: readonly RevisionGraphRow[]): string[] => rows.map(row => row.commitId)

const rowOf = (rows: readonly RevisionGraphRow[], commitId: string): RevisionGraphRow => {
  const row = rows.find(candidate => candidate.commitId === commitId)
  if (row === undefined) throw new Error(`no row for ${commitId}`)
  return row
}

/** Two segments in the same half-row cross when their left-to-right order flips between its edges. */
const crossingsIn = (segments: readonly Pick<GraphLink, 'fromLane' | 'toLane'>[]): number => {
  let crossings = 0
  for (const [index, left] of segments.entries()) {
    for (const right of segments.slice(index + 1)) {
      if ((left.fromLane - right.fromLane) * (left.toLane - right.toLane) < 0) crossings += 1
    }
  }
  return crossings
}

const crossings = (rows: readonly RevisionGraphRow[]): number =>
  rows.reduce((total, row) => total + crossingsIn([...row.passing, ...row.outgoing.filter(link => !link.terminal)]), 0)

/** Every lane leaving a row's bottom edge enters the next row's top edge, and nothing else does. */
const brokenLanes = (rows: readonly RevisionGraphRow[]): string[] =>
  rows.slice(1).flatMap((row, index) => {
    const above = new Set((rows[index]?.bottomLanes ?? []).map(lane => lane.lane))
    const below = new Set(row.topLanes.map(lane => lane.lane))
    return [...above].sort().join() === [...below].sort().join() ? [] : [`${rows[index]?.commitId} → ${row.commitId}`]
  })

const isContiguous = (rows: readonly RevisionGraphRow[], block: readonly string[]): boolean => {
  const positions = block.map(id => ids(rows).indexOf(id))
  return positions.every((position, index) => position === (positions[0] ?? -1) + index)
}

const lanesOf = (rows: readonly RevisionGraphRow[], block: readonly string[]): number[] => [...new Set(block.map(id => rowOf(rows, id).commitLane))]

// Listed in `jj log --no-graph` index order: newest first.
const secret = chain('secret', 6, 'main3')
const tool = chain('tool', 4, 'main3')
const dates = chain('dates', 2, 'snooze1')
const snooze = chain('snooze', 3, 'main0')
const editing = chain('editing', 1, 'main0')
const tabs = chain('tabs', 1, 'main4')
const emptyHead = chain('settings', 1, 'main5')
const merge = [revision('merge', ['main6', 'side0'])]
const side = chain('side', 2, 'main8')
const feature = chain('feature', 2, 'main7', index => ({ bookmarks: index === 0 ? ['feature'] : [] }))
const trunk = chain('main', 10, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [], immutable: index > 0 }))
const userLike = [...secret, ...tool, ...dates, ...snooze, ...editing, ...tabs, ...emptyHead, ...merge, ...side, ...feature, ...trunk]
const blocks = { secret, tool, dates, snooze, editing, tabs, emptyHead, merge, side, feature }

describe('branch layout', () => {
  const rows = layout(userLike)

  test('every branch is one contiguous block, nested on top of its parent branch and above the trunk revision it forks from', () => {
    for (const block of Object.values(blocks))
      expect(
        isContiguous(
          rows,
          block.map(row => row.commitId),
        ),
      ).toBe(true)
    expect(ids(rows)).toEqual([
      ...['dates0', 'dates1', 'snooze0', 'snooze1', 'snooze2', 'editing0', 'main0', 'main1', 'main2'],
      ...['secret0', 'secret1', 'secret2', 'secret3', 'secret4', 'secret5', 'tool0', 'tool1', 'tool2', 'tool3', 'main3'],
      ...['tabs0', 'main4', 'settings0', 'main5', 'merge', 'main6', 'feature0', 'feature1', 'main7', 'side0', 'side1', 'main8', 'main9'],
    ])
  })

  test('the trunk keeps lane 0, the topmost child continues its parent line, other branches reuse lane 1, and nothing crosses', () => {
    expect(
      lanesOf(
        rows,
        trunk.map(row => row.commitId),
      ),
    ).toEqual([0])
    for (const block of [secret, tool, editing, tabs, emptyHead, merge, feature])
      expect(
        lanesOf(
          rows,
          block.map(row => row.commitId),
        ),
      ).toEqual([1])
    expect(lanesOf(rows, ['dates0', 'dates1', 'snooze1', 'snooze2'])).toEqual([0])
    expect(lanesOf(rows, ['snooze0'])).toEqual([1])
    expect(Math.max(...rows.map(row => row.laneCount))).toBe(3)
    expect(crossings(rows)).toBe(0)
    expect(brokenLanes(rows)).toEqual([])
  })

  test('a branch joins its parent lane with one turn right below its last revision', () => {
    expect(rowOf(rows, 'secret5').outgoing).toEqual([{ fromLane: 1, toLane: 0, color: rowOf(rows, 'secret5').color, dashed: false, terminal: false }])
    expect(rowOf(rows, 'tool0').incoming).toEqual([])
    expect(rowOf(rows, 'tool0').passing.map(link => [link.fromLane, link.toLane])).toEqual([[0, 0]])
    // snooze1 has two children, so it opens its own line: dates continues straight into it and snooze0 curves in.
    expect(rowOf(rows, 'dates1').outgoing.map(link => [link.fromLane, link.toLane])).toEqual([[0, 0]])
    expect(rowOf(rows, 'snooze0').outgoing.map(link => [link.fromLane, link.toLane])).toEqual([[1, 0]])
  })

  test('a merge opens its second parent to the right and that branch rejoins the trunk at its own fork', () => {
    expect(rowOf(rows, 'merge').outgoing.map(link => link.toLane)).toEqual([0, 2])
    expect(rowOf(rows, 'side0').commitLane).toBe(2)
    expect(rowOf(rows, 'side1').outgoing.map(link => link.toLane)).toEqual([0])
  })

  test('neighbouring branches get different colors and the trunk keeps color 0', () => {
    expect(new Set(trunk.map(row => rowOf(rows, row.commitId).color))).toEqual(new Set([0]))
    const headColors = ['secret0', 'tool0', 'tabs0', 'settings0', 'merge', 'feature0'].map(id => rowOf(rows, id).color)
    for (const [index, color] of headColors.entries()) expect(color).not.toBe(headColors[index - 1])
    expect(rowOf(rows, 'dates0').color).not.toBe(rowOf(rows, 'snooze0').color)
  })

  test('an empty workspace head is a one-revision branch', () => {
    expect(rowOf(rows, 'settings0')).toMatchObject({ commitLane: 1, incoming: [] })
    expect(rowOf(rows, 'settings0').outgoing.map(link => link.toLane)).toEqual([0])
  })
})

describe('lane allocation', () => {
  test('a long linear trunk is a single straight lane', () => {
    const rows = layout(chain('commit', 200, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] })))
    expect(rows.every(row => row.commitLane === 0 && row.laneCount === 1)).toBe(true)
    expect(rows.at(-1)?.outgoing).toEqual([])
  })

  test('the trunk lane stays empty above the highest branch that joins it', () => {
    const rows = layout([...chain('side', 2, 'main0'), ...chain('main', 2, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] }))])
    expect(rowOf(rows, 'side0').passing).toEqual([])
    expect(rowOf(rows, 'side1').passing).toEqual([])
    expect(rowOf(rows, 'main0').incoming).toEqual([{ fromLane: 0, toLane: 0, color: 0, dashed: false, terminal: false }])
  })

  test('a revision two branches share opens its own line: the topmost child continues it and the other curves in', () => {
    const rows = layout([
      ...chain('nested', 1, 'parent2'),
      ...chain('parent', 3, 'main0'),
      ...chain('later', 2, 'main1'),
      ...chain('main', 3, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] })),
    ])
    expect(ids(rows)).toEqual(['nested0', 'parent0', 'parent1', 'parent2', 'main0', 'later0', 'later1', 'main1', 'main2'])
    expect(lanesOf(rows, ['nested0', 'parent2'])).toEqual([0])
    expect(lanesOf(rows, ['parent0', 'parent1'])).toEqual([1])
    expect(lanesOf(rows, ['later0', 'later1'])).toEqual([1])
    expect(rowOf(rows, 'parent1').outgoing.map(link => [link.fromLane, link.toLane])).toEqual([[1, 0]])
    expect(crossings(rows)).toBe(0)
    expect(brokenLanes(rows)).toEqual([])
  })

  test('branches forking at the same trunk revision stack newest first in the freed lane', () => {
    const rows = layout([
      ...chain('newer', 2, 'main1'),
      ...chain('older', 1, 'main1'),
      ...chain('main', 2, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] })),
    ])
    expect(ids(rows)).toEqual(['main0', 'newer0', 'newer1', 'older0', 'main1'])
    expect(rows.map(row => row.commitLane)).toEqual([0, 1, 1, 1, 0])
  })

  test('without a visible trunk bookmark, branches are ordered by their newest head and start in lane 0', () => {
    const all = [
      ...chain('fresh', 2, 'main0'),
      ...chain('stale', 1, 'main0'),
      ...chain('main', 2, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [], immutable: true })),
    ]
    const rows = layout(
      all.filter(row => !row.immutable),
      true,
      all,
    )
    expect(ids(rows)).toEqual(['fresh0', 'fresh1', 'stale0'])
    expect(rows.map(row => row.commitLane)).toEqual([0, 0, 0])
    expect(rowOf(rows, 'fresh1').outgoing).toEqual([{ fromLane: 0, toLane: 0, color: rowOf(rows, 'fresh1').color, dashed: true, terminal: true }])
  })

  test('a parent outside the loaded graph ends in a stub', () => {
    const rows = layout([...chain('old', 1, 'beyond-limit'), ...chain('main', 2, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] }))])
    expect(rowOf(rows, 'old0').outgoing).toEqual([{ fromLane: 1, toLane: 1, color: rowOf(rows, 'old0').color, dashed: false, terminal: true }])
  })

  test('hiding long immutable ancestry keeps its bridge depth and terminal link', () => {
    const head = revision('head', ['immutable0'])
    const immutable = chain('immutable', 1200, undefined, () => ({ immutable: true }))
    const rows = layout([head], false, [head, ...immutable])
    expect(rowOf(rows, 'head').outgoing).toEqual([{ fromLane: 0, toLane: 0, color: rowOf(rows, 'head').color, dashed: true, terminal: true }])
    expect(RevisionGraphModel.graphParentLinks(head, new Map([head, ...immutable].map(row => [row.commitId, row])), false, new Set(['head']))).toEqual([
      { commitId: 'immutable1199', label: 'immutable1199', hiddenParentCount: 1200, terminal: true },
    ])
  })

  test('mine-only graph links bridge hidden ancestry with dashed rails', () => {
    const feature = revision('feature', ['foreign'])
    const foreign = revision('foreign', ['trunk'])
    const trunkRow = revision('trunk', [], { bookmarks: ['main'], immutable: true })
    const rows = RevisionGraphModel.layoutRevisionGraph([feature, trunkRow], new Map([feature, foreign, trunkRow].map(row => [row.commitId, row])), false)
    expect(rowOf(rows, 'feature').outgoing).toEqual([{ fromLane: 0, toLane: 0, color: rowOf(rows, 'feature').color, dashed: true, terminal: false }])
  })

  test('a group holding a merge goes above the newer group holding its other parent, and its second parent opens a lane to the right', () => {
    const rows = layout([
      ...chain('b', 1, 'main0'),
      revision('merge', ['a0', 'b0']),
      ...chain('a', 1, 'main0'),
      ...chain('main', 2, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] })),
    ])
    expect(ids(rows)).toEqual(['merge', 'a0', 'b0', 'main0', 'main1'])
    expect(rows.map(row => row.commitLane)).toEqual([0, 0, 1, 0, 0])
    expect(rowOf(rows, 'merge').outgoing.map(link => link.toLane)).toEqual([0, 1])
    expect(crossings(rows)).toBe(0)
    expect(brokenLanes(rows)).toEqual([])
  })

  test('many workspaces on one shared revision stack in a single lane and curve into its line', () => {
    const heads = Array.from({ length: 10 }, (_, index) => chain(`head${index}-`, 1 + (index % 3), 'fork0'))
    const rows = layout([...heads.flat(), ...chain('fork', 3, 'main1'), ...chain('main', 3, undefined, index => ({ bookmarks: index === 0 ? ['main'] : [] }))])
    expect(Math.max(...rows.map(row => row.laneCount))).toBe(3)
    expect(lanesOf(rows, ['head0-0', 'fork0', 'fork1', 'fork2'])).toEqual([1])
    expect(
      lanesOf(
        rows,
        heads
          .slice(1)
          .flat()
          .map(row => row.commitId),
      ),
    ).toEqual([2])
    expect(crossings(rows)).toBe(0)
    expect(brokenLanes(rows)).toEqual([])
  })
})

describe('random merge-free histories', () => {
  test('stay in topological order with continuous, uncrossed lanes', () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const count = 3 + Math.floor(random() * 30)
      const trunkIndex = random() < 0.8 ? Math.floor(random() * count) : -1
      const revisions = Array.from({ length: count }, (_, index) =>
        revision(`r${index}`, index < count - 1 ? [`r${index + 1 + Math.floor(random() * Math.min(5, count - index - 1))}`] : [], {
          bookmarks: index === trunkIndex ? ['main'] : [],
        }),
      )
      const rows = layout(revisions)
      const position = new Map(ids(rows).map((id, index) => [id, index]))
      expect(rows).toHaveLength(count)
      expect(revisions.filter(row => row.parents.some(parent => (position.get(parent) ?? 0) <= (position.get(row.commitId) ?? 0)))).toEqual([])
      expect(crossings(rows)).toBe(0)
      expect(brokenLanes(rows)).toEqual([])
    }
  })
})
