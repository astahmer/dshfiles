import { describe, expect, test } from 'vitest'
import type { Revision } from './api.ts'
import { groupRevisionsByBranch, layoutRevisionGraph, type GraphLink, type RevisionGraphRow } from './graph.ts'

type FixtureRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable' | 'bookmarks' | 'workspaces' | 'workingCopy' | 'divergent'>

const revision = (commitId: string, parents: readonly string[], options: Partial<FixtureRevision> = {}): FixtureRevision => ({
  commitId,
  parents: [...parents],
  shortestChangeId: commitId,
  immutable: false,
  bookmarks: [],
  workspaces: [],
  workingCopy: false,
  divergent: false,
  ...options,
})

const layout = (revisions: readonly FixtureRevision[], hideImmutable = false): readonly RevisionGraphRow[] =>
  layoutRevisionGraph(revisions, new Map(revisions.map(row => [row.commitId, row])), hideImmutable)

const linearTrunk = (prefix: string, count: number, options: (index: number) => Partial<FixtureRevision> = () => ({})): FixtureRevision[] =>
  Array.from({ length: count }, (_, index) => revision(`${prefix}${index}`, index + 1 < count ? [`${prefix}${index + 1}`] : [], options(index)))

/** Two segments in the same band cross when their left-to-right order flips between its edges. */
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
  rows.reduce(
    (total, row) =>
      total +
      crossingsIn([...row.incoming, ...row.passing.map(link => ({ fromLane: link.fromLane, toLane: link.fromLane }))]) +
      crossingsIn([...row.passing, ...row.outgoing.filter(link => !link.terminal)]),
    0,
  )

const rowOf = (rows: readonly RevisionGraphRow[], commitId: string): RevisionGraphRow => {
  const row = rows.find(candidate => candidate.commitId === commitId)
  if (row === undefined) throw new Error(`no row for ${commitId}`)
  return row
}

describe('revision graph lanes', () => {
  test('workspace heads branching from @ sit in one side lane and rejoin the straight trunk without crossings', () => {
    const rows = layout([
      revision('settings-head', ['settings-base'], { workspaces: ['thread-attention-settings'] }),
      revision('settings-base', ['working']),
      revision('e2e-head', ['working'], { workspaces: ['plugin-e2e-coverage-resume'] }),
      revision('observability-head', ['working'], { workspaces: ['agent-communication-observability-recovery'] }),
      revision('history-head', ['working'], { workspaces: ['agent-session-history-current'] }),
      revision('working', ['trunk0'], { workingCopy: true, workspaces: ['default'] }),
      ...linearTrunk('trunk', 12, index => ({ immutable: index >= 6, bookmarks: index === 6 ? ['main'] : [] })),
    ])

    expect(rows.filter(row => row.commitId === 'working' || row.commitId.startsWith('trunk')).map(row => row.commitLane)).toEqual(Array(13).fill(0))
    expect(['settings-head', 'settings-base', 'e2e-head', 'observability-head', 'history-head'].map(id => rowOf(rows, id).commitLane)).toEqual([1, 1, 1, 1, 1])
    expect(Math.max(...rows.map(row => row.laneCount))).toBe(2)
    expect(crossings(rows)).toBe(0)
    expect(rowOf(rows, 'settings-base').outgoing).toEqual([{ fromLane: 1, toLane: 0, tone: 'workspace', dashed: false, terminal: false }])
    expect(rowOf(rows, 'working').tone).toBe('trunk')
    expect(rowOf(rows, 'settings-head').incoming).toEqual([])
  })

  test('the trunk lane stays empty above the trunk head instead of drawing a line from the top', () => {
    const rows = layout([revision('side', ['working'], { workspaces: ['other'] }), revision('working', ['base'], { workingCopy: true }), revision('base', [])])

    expect(rowOf(rows, 'side').passing).toEqual([])
    expect(rowOf(rows, 'side').commitLane).toBe(1)
    expect(rowOf(rows, 'working').incoming).toEqual([{ fromLane: 0, toLane: 0, tone: 'trunk', dashed: false, terminal: false }])
  })

  test('a long linear trunk is a single straight lane', () => {
    const rows = layout(linearTrunk('commit', 200, index => ({ workingCopy: index === 0, immutable: index > 20 })))

    expect(rows.every(row => row.commitLane === 0 && row.laneCount === 1)).toBe(true)
    expect(rows.at(-1)?.outgoing).toEqual([])
  })

  test('divergent copies get their own tone and rejoin the trunk at their own parents', () => {
    const rows = layout([
      revision('copy-new', ['trunk1'], { divergent: true, shortestChangeId: 'xz' }),
      revision('copy-old', ['trunk3'], { divergent: true, shortestChangeId: 'xz' }),
      ...linearTrunk('trunk', 6, index => ({ workingCopy: index === 0 })),
    ])

    expect(rowOf(rows, 'copy-new')).toMatchObject({ commitLane: 1, tone: 'divergent' })
    expect(rowOf(rows, 'copy-old')).toMatchObject({ commitLane: 2, tone: 'divergent' })
    expect(rows.filter(row => row.commitId.startsWith('trunk')).every(row => row.commitLane === 0)).toBe(true)
    expect(rowOf(rows, 'trunk0').passing).toContainEqual({ fromLane: 1, toLane: 0, tone: 'divergent', dashed: false, terminal: false })
    expect(crossings(rows)).toBe(0)
  })

  test('@ on a feature branch keeps the trunk bookmark line on the left', () => {
    const rows = layout([
      revision('main-new', ['main-old'], { bookmarks: ['main'], immutable: true }),
      revision('feature', ['feature-base'], { workingCopy: true }),
      revision('feature-base', ['main-old']),
      revision('main-old', ['root'], { immutable: true }),
      revision('root', [], { immutable: true }),
    ])

    expect(['main-new', 'main-old', 'root'].map(id => rowOf(rows, id).commitLane)).toEqual([0, 0, 0])
    expect(rowOf(rows, 'feature')).toMatchObject({ commitLane: 1, tone: 'current' })
    expect(crossings(rows)).toBe(0)
  })

  test('a merge opens its second parent to the right and the side line rejoins without crossings', () => {
    const rows = layout([revision('merge', ['trunk0', 'side'], { workingCopy: true }), revision('side', ['trunk2']), ...linearTrunk('trunk', 4)])

    expect(rowOf(rows, 'merge').outgoing.map(link => link.toLane)).toEqual([0, 1])
    expect(rowOf(rows, 'side').commitLane).toBe(1)
    expect(crossings(rows)).toBe(0)
  })

  test('mine-only graph links bridge hidden non-mine ancestry with dashed rails', () => {
    const feature = revision('feature', ['foreign'], { workingCopy: true })
    const foreign = revision('foreign', ['trunk'])
    const trunk = revision('trunk', [], { bookmarks: ['main'], immutable: true })
    const allRevisions = [feature, foreign, trunk]
    const rows = layoutRevisionGraph([feature, trunk], new Map(allRevisions.map(row => [row.commitId, row])), false)

    expect(rowOf(rows, 'feature').outgoing).toEqual([{ fromLane: 0, toLane: 0, tone: 'trunk', dashed: true, terminal: false }])
    expect(rowOf(rows, 'trunk').commitLane).toBe(0)
  })

  test('parents outside the loaded graph end in a stub and free their lane for the next head', () => {
    const rows = layout([
      revision('old-branch', ['beyond-limit'], { workspaces: ['stale'] }),
      revision('fresh-branch', ['trunk1'], { workspaces: ['fresh'] }),
      ...linearTrunk('trunk', 3, index => ({ workingCopy: index === 0 })),
    ])

    expect(rowOf(rows, 'old-branch').outgoing).toEqual([{ fromLane: 1, toLane: 1, tone: 'workspace', dashed: false, terminal: true }])
    expect(rowOf(rows, 'fresh-branch').commitLane).toBe(1)
    expect(Math.max(...rows.map(row => row.laneCount))).toBe(2)
  })

  test('a new head reuses the leftmost freed lane instead of opening one right of a long branch', () => {
    const rows = layout([
      revision('short-head', ['short-base'], { workspaces: ['short'] }),
      revision('long-head', ['long-base'], { workspaces: ['long'] }),
      revision('short-base', ['trunk0']),
      revision('late-head', ['trunk0'], { workspaces: ['late'] }),
      revision('long-base', ['trunk1']),
      ...linearTrunk('trunk', 3, index => ({ workingCopy: index === 0 })),
    ])

    expect(['short-head', 'long-head', 'late-head', 'long-base'].map(id => rowOf(rows, id).commitLane)).toEqual([1, 2, 1, 2])
    expect(rowOf(rows, 'trunk0').passing).toEqual([{ fromLane: 2, toLane: 0, tone: 'workspace', dashed: false, terminal: false }])
    expect(crossings(rows)).toBe(0)
  })
})

describe('branch grouping order', () => {
  // `jj log --no-graph` index order for the repository in the screenshots: a divergent copy of the
  // e2e workspace head was rewritten onto an older commit, yet still sorts second by index.
  const indexOrder = [
    revision('e2e-head', ['working'], { workspaces: ['plugin-e2e-coverage-resume'], divergent: true }),
    revision('e2e-copy', ['trunk1'], { divergent: true }),
    revision('settings-head', ['settings-base'], { workspaces: ['thread-attention-settings'] }),
    revision('settings-base', ['working']),
    revision('history-head', ['working'], { workspaces: ['agent-session-history-current'] }),
    revision('working', ['trunk0'], { workingCopy: true, workspaces: ['default'] }),
    ...linearTrunk('trunk', 4),
  ]

  test('places every side branch directly above the commit it forks from, newest head on top', () => {
    expect(groupRevisionsByBranch(indexOrder).map(row => row.commitId)).toEqual([
      'e2e-head',
      'settings-head',
      'settings-base',
      'history-head',
      'working',
      'trunk0',
      'e2e-copy',
      'trunk1',
      'trunk2',
      'trunk3',
    ])
  })

  test('grouping keeps the graph two lanes wide where index order needs three and crosses lanes', () => {
    const grouped = layout(groupRevisionsByBranch(indexOrder))
    const scattered = layout(indexOrder)

    expect(Math.max(...grouped.map(row => row.laneCount))).toBe(2)
    expect(crossings(grouped)).toBe(0)
    expect(Math.max(...scattered.map(row => row.laneCount))).toBe(3)
    expect(crossings(scattered)).toBeGreaterThan(0)
  })

  test('a merge is placed only after both of its parents', () => {
    const order = groupRevisionsByBranch([revision('merge', ['left', 'right']), revision('left', ['base']), revision('right', ['base']), revision('base', [])])
    expect(order.at(0)?.commitId).toBe('merge')
    expect(order.at(-1)?.commitId).toBe('base')
  })
})
