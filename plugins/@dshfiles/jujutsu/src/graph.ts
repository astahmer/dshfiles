import type { Revision } from './api.js'

type SearchableRevision = Pick<Revision, 'description' | 'changeId' | 'commitId' | 'shortestChangeId' | 'bookmarks' | 'tags' | 'workspaces'>
type ParentRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable'>
type LayoutRevision = ParentRevision & Pick<Revision, 'bookmarks'>

/** Side branches cycle through this many hues (the kit's graph-1…6); color 0 is the trunk. */
const GRAPH_BRANCH_COLORS = 6

export interface GraphLink {
  readonly fromLane: number
  readonly toLane: number
  /** 0 for the trunk, 1…GRAPH_BRANCH_COLORS for side branches. */
  readonly color: number
  readonly dashed: boolean
  /** The parent is outside the loaded graph: drawn as a short fading stub instead of a lane. */
  readonly terminal: boolean
}

export interface GraphLane {
  readonly lane: number
  readonly color: number
}

/**
 * One row of the revision graph. Lines enter at the top edge, the node sits in the middle, and every
 * lane change happens in the lower half of the row, so all rows keep one height.
 */
export interface RevisionGraphRow {
  readonly commitId: string
  readonly commitLane: number
  readonly color: number
  readonly laneCount: number
  /** The lane arriving at this node from above, if any. */
  readonly incoming: readonly GraphLink[]
  /** Lanes of other revisions crossing this row, possibly turning into another lane below the node. */
  readonly passing: readonly GraphLink[]
  /** Links from this node to its parents. */
  readonly outgoing: readonly GraphLink[]
  readonly topLanes: readonly GraphLane[]
  readonly bottomLanes: readonly GraphLane[]
}

export interface GraphParentLink {
  readonly commitId: string
  readonly label: string
  readonly hiddenParentCount: number
  readonly terminal: boolean
}

/** Ignore JJ's canonical trailing newline when comparing the editable description. */
export const describeDraftChanged = (draft: string, current: string): boolean => draft.replace(/\n+$/, '') !== current.replace(/\n+$/, '')

/** Search full IDs and the user-visible revision labels. */
export const matchesRevisionSearch = (revision: SearchableRevision, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  return [
    revision.description,
    revision.changeId,
    revision.commitId,
    revision.shortestChangeId,
    ...revision.bookmarks,
    ...revision.tags,
    ...revision.workspaces,
  ]
    .join('\n')
    .toLocaleLowerCase()
    .includes(needle)
}

/** Collapse hidden parents into explicit links to the nearest visible ancestors. */
export const graphParentLinks = (
  revision: ParentRevision,
  revisionsById: ReadonlyMap<string, ParentRevision>,
  hideImmutable: boolean,
  visibleCommitIds?: ReadonlySet<string>,
): GraphParentLink[] => {
  const links = new Map<string, GraphParentLink>()
  const visit = (commitId: string, hiddenParentCount: number, seen: ReadonlySet<string>): void => {
    const parent = revisionsById.get(commitId)
    if (parent === undefined) {
      links.set(commitId, { commitId, label: commitId.slice(0, 8), hiddenParentCount, terminal: false })
      return
    }
    const visible = (!hideImmutable || !parent.immutable) && (visibleCommitIds === undefined || visibleCommitIds.has(commitId))
    if (visible) {
      links.set(commitId, { commitId, label: parent.shortestChangeId, hiddenParentCount, terminal: false })
      return
    }
    if (seen.has(commitId)) return
    const nextSeen = new Set(seen).add(commitId)
    if (parent.parents.length === 0) {
      links.set(commitId, {
        commitId,
        label: parent.shortestChangeId,
        hiddenParentCount: hiddenParentCount + 1,
        terminal: true,
      })
      return
    }
    for (const nextParent of parent.parents) visit(nextParent, hiddenParentCount + 1, nextSeen)
  }
  for (const parentId of revision.parents) visit(parentId, 0, new Set([revision.commitId]))
  return [...links.values()]
}

const TRUNK_BOOKMARKS = new Set(['main', 'master', 'trunk'])

/** A branch: one head and its first-parent chain down to the revision another branch already owns. */
interface Branch {
  readonly revisions: string[]
  readonly recency: number
  readonly nested: Branch[]
  parent: Branch | undefined
  fork: string | undefined
  /** The newest head among this branch and the branches nested on it. */
  groupRecency: number
}

/**
 * A vertical run in one lane, in half-row bands (row r spans bands 2r and 2r + 1, its node sits between
 * them): a branch, the trunk, or a connector carrying a link past rows it must not touch.
 */
interface LaneRun {
  start: number
  end: number
  lane: number
  color: number
  readonly minLane: number
}

/** A turn from one run into another in the lower half of a row. */
interface LaneTurn {
  readonly band: number
  readonly from: LaneRun
  readonly to: LaneRun
}

const byGroupRecency = (left: Branch, right: Branch): number => left.groupRecency - right.groupRecency

/**
 * Topological order with each branch as one contiguous block: under each trunk revision come the branches
 * forking from it, newest head first, and a branch forking from another side branch sits directly above
 * that branch. A merge that cannot keep this falls back to the nearest valid order.
 */
const orderBranches = (input: {
  readonly revisions: readonly LayoutRevision[]
  readonly firstParent: (commitId: string) => string | undefined
  readonly listedParents: (commitId: string) => readonly string[]
  readonly children: ReadonlyMap<string, readonly string[]>
}) => {
  const owner = new Map<string, Branch>()
  const branches: Branch[] = []
  const claim = (head: string, recency: number): Branch => {
    const branch: Branch = { revisions: [], recency, nested: [], parent: undefined, fork: undefined, groupRecency: recency }
    let current: string | undefined = head
    while (current !== undefined && !owner.has(current)) {
      owner.set(current, branch)
      branch.revisions.push(current)
      current = input.firstParent(current)
    }
    branch.fork = current
    branches.push(branch)
    return branch
  }

  const trunkHead = input.revisions.find(revision => revision.bookmarks.some(name => TRUNK_BOOKMARKS.has(name)))
  const trunk = trunkHead === undefined ? undefined : claim(trunkHead.commitId, Number.POSITIVE_INFINITY)
  if (trunk !== undefined) trunk.fork = undefined

  // `jj log --no-graph` lists the newest revisions first. Walking it backwards lets the older head keep a shared
  // ancestor, so a workspace started on another workspace's revision nests on that workspace, not the reverse.
  const oldestFirst = [...input.revisions.entries()].reverse()
  while (owner.size < input.revisions.length) {
    let claimed = false
    for (const [index, revision] of oldestFirst) {
      if (owner.has(revision.commitId)) continue
      if (!(input.children.get(revision.commitId) ?? []).every(child => owner.has(child))) continue
      claim(revision.commitId, index)
      claimed = true
    }
    if (!claimed) {
      const index = input.revisions.findIndex(revision => !owner.has(revision.commitId))
      const revision = input.revisions[index]
      if (revision !== undefined) claim(revision.commitId, index)
    }
  }

  for (const branch of branches) {
    if (branch === trunk || branch.fork === undefined) continue
    branch.parent = owner.get(branch.fork)
    branch.parent?.nested.push(branch)
  }
  const groupRecency = (branch: Branch): number => {
    branch.groupRecency = Math.min(branch.recency, ...branch.nested.map(groupRecency))
    return branch.groupRecency
  }
  for (const branch of branches) if (branch.parent === undefined) groupRecency(branch)

  const members = (branch: Branch): string[] => [...branch.revisions, ...branch.nested.flatMap(members)]
  /** Newest group first, except that a group holding a merge goes above the group holding its other parent. */
  const siblingOrder = (groups: readonly Branch[]): Branch[] => {
    const memberSets = new Map(groups.map(group => [group, new Set(members(group))]))
    const feeds = (child: Branch, parent: Branch): boolean =>
      [...(memberSets.get(child) ?? [])].some(commitId => input.listedParents(commitId).some(id => memberSets.get(parent)?.has(id)))
    const remaining = [...groups].sort(byGroupRecency)
    const sorted: Branch[] = []
    while (remaining.length > 0) {
      const index = Math.max(
        0,
        remaining.findIndex(group => !remaining.some(other => other !== group && feeds(other, group))),
      )
      sorted.push(...remaining.splice(index, 1))
    }
    return sorted
  }

  const order: string[] = []
  const emitGroup = (branch: Branch): void => {
    for (const nested of siblingOrder(branch.nested)) emitGroup(nested)
    order.push(...branch.revisions)
  }
  if (trunk !== undefined) {
    const forkingAt = new Map<string, Branch[]>()
    for (const nested of trunk.nested) forkingAt.set(nested.fork ?? '', [...(forkingAt.get(nested.fork ?? '') ?? []), nested])
    for (const commitId of trunk.revisions) {
      for (const nested of siblingOrder(forkingAt.get(commitId) ?? [])) emitGroup(nested)
      order.push(commitId)
    }
  }
  for (const branch of siblingOrder(branches.filter(candidate => candidate !== trunk && candidate.parent === undefined))) emitGroup(branch)

  const position = new Map(order.map((commitId, index) => [commitId, index]))
  const valid = order.every(commitId => input.listedParents(commitId).every(parent => (position.get(parent) ?? 0) > (position.get(commitId) ?? 0)))
  if (valid) return { order, owner, trunk, branches }

  // Kahn's algorithm, always taking the ready revision that comes first in the preferred order.
  const waitingChildren = new Map(order.map(commitId => [commitId, (input.children.get(commitId) ?? []).length]))
  const repaired: string[] = []
  const ready = new Set(order.filter(commitId => waitingChildren.get(commitId) === 0))
  while (ready.size > 0) {
    const next = [...ready].reduce((best, commitId) => ((position.get(commitId) ?? 0) < (position.get(best) ?? 0) ? commitId : best))
    ready.delete(next)
    repaired.push(next)
    for (const parent of input.listedParents(next)) {
      const remaining = (waitingChildren.get(parent) ?? 1) - 1
      waitingChildren.set(parent, remaining)
      if (remaining === 0) ready.add(parent)
    }
  }
  return { order: repaired.length === order.length ? repaired : order, owner, trunk, branches }
}

/**
 * Lay out the revision graph the way VisualJJ reads: the trunk bookmark's first-parent line stays straight in
 * lane 0, every other head opens a branch whose revisions form one contiguous block down to its fork point,
 * and each branch joins its parent with one turn at its bottom. Lanes are taken leftmost-first among those
 * whose run and turns cross no other lane, and are reused only once a branch has ended. Returns the rows in
 * display order; a parent outside the loaded graph ends in a stub.
 */
export const layoutRevisionGraph = (
  revisions: readonly LayoutRevision[],
  revisionsById: ReadonlyMap<string, ParentRevision>,
  hideImmutable: boolean,
): readonly RevisionGraphRow[] => {
  const listed = new Set(revisions.map(revision => revision.commitId))
  const parentLinks = new Map(revisions.map(revision => [revision.commitId, graphParentLinks(revision, revisionsById, hideImmutable, listed)]))
  const listedParents = (commitId: string): string[] => (parentLinks.get(commitId) ?? []).flatMap(link => (listed.has(link.commitId) ? [link.commitId] : []))
  const firstParent = (commitId: string): string | undefined => {
    const first = parentLinks.get(commitId)?.[0]?.commitId
    return first !== undefined && listed.has(first) ? first : undefined
  }
  const children = new Map<string, string[]>()
  for (const revision of revisions) {
    for (const parent of new Set(listedParents(revision.commitId))) children.set(parent, [...(children.get(parent) ?? []), revision.commitId])
  }

  const { order, owner, trunk, branches } = orderBranches({ revisions, firstParent, listedParents, children })
  const row = new Map(order.map((commitId, index) => [commitId, index]))
  const rowOf = (commitId: string): number => row.get(commitId) ?? 0
  const sideLaneFloor = trunk === undefined ? 0 : 1

  const runs = new Map<Branch, LaneRun>()
  for (const branch of branches) {
    const rows = branch.revisions.map(rowOf)
    const minLane = branch === trunk ? 0 : branch.parent === undefined || branch.parent === trunk ? sideLaneFloor : -1
    runs.set(branch, { start: 2 * Math.min(...rows), end: 2 * Math.max(...rows), lane: branch === trunk ? 0 : -1, color: 0, minLane })
  }
  const runOf = (commitId: string): LaneRun | undefined => {
    const branch = owner.get(commitId)
    return branch === undefined ? undefined : runs.get(branch)
  }
  const connectors: { readonly run: LaneRun; readonly source: LaneRun }[] = []
  const turns: LaneTurn[] = []
  /** Where each outgoing link of a revision goes: its own run, another run, or a stub. */
  const links = new Map<string, { readonly target: LaneRun | 'stub'; readonly dashed: boolean }[]>()

  for (const commitId of order) {
    const run = runOf(commitId)
    if (run === undefined) continue
    const childRow = rowOf(commitId)
    const branch = owner.get(commitId)
    const isLast = branch?.revisions.at(-1) === commitId
    links.set(
      commitId,
      (parentLinks.get(commitId) ?? []).map((link, parentIndex) => {
        const dashed = link.hiddenParentCount > 0
        const parentRun = runOf(link.commitId)
        if (!listed.has(link.commitId) || parentRun === undefined) return { target: 'stub' as const, dashed }
        const parentRow = rowOf(link.commitId)
        const parentBranch = owner.get(link.commitId)
        const blocked = (parentBranch?.revisions ?? []).some(other => {
          const otherRow = rowOf(other)
          return otherRow > childRow && otherRow < parentRow
        })
        if (!blocked) {
          if (parentRun === run) return { target: run, dashed }
          parentRun.start = Math.min(parentRun.start, 2 * childRow + 1)
          run.end = Math.max(run.end, 2 * childRow + 1)
          turns.push({ band: 2 * childRow + 1, from: run, to: parentRun })
          return { target: parentRun, dashed }
        }
        const lastBand = 2 * (parentRow - 1) + 1
        if (parentIndex === 0 && isLast && parentRun !== run) {
          run.end = Math.max(run.end, lastBand)
          turns.push({ band: lastBand, from: run, to: parentRun })
          return { target: run, dashed }
        }
        const connector: LaneRun = { start: 2 * childRow + 1, end: lastBand, lane: -1, color: 0, minLane: sideLaneFloor }
        connectors.push({ run: connector, source: run })
        run.end = Math.max(run.end, 2 * childRow + 1)
        turns.push({ band: 2 * childRow + 1, from: run, to: connector }, { band: lastBand, from: connector, to: parentRun })
        return { target: connector, dashed }
      }),
    )
  }

  const allocated: LaneRun[] = trunk === undefined ? [] : [runs.get(trunk)].filter(run => run !== undefined)
  const overlaps = (left: LaneRun, right: LaneRun): boolean => left.start <= right.end && right.start <= left.end
  const laneOf = (run: LaneRun, candidate: LaneRun, lane: number): number => (run === candidate ? lane : run.lane)
  const turnsCross = (left: { from: number; to: number }, right: { from: number; to: number }): boolean => (left.from - right.from) * (left.to - right.to) < 0
  const fits = (candidate: LaneRun, lane: number): boolean => {
    if (allocated.some(run => run.lane === lane && overlaps(run, candidate))) return false
    for (const turn of turns) {
      const from = laneOf(turn.from, candidate, lane)
      const to = laneOf(turn.to, candidate, lane)
      if (from < 0 || to < 0) continue
      const involved = turn.from === candidate || turn.to === candidate
      const low = Math.min(from, to)
      const high = Math.max(from, to)
      if (!involved) {
        if (candidate.start <= turn.band && turn.band <= candidate.end && lane > low && lane < high) return false
        continue
      }
      const between = allocated.some(
        run => run !== turn.from && run !== turn.to && run.lane > low && run.lane < high && run.start <= turn.band && turn.band <= run.end,
      )
      if (between) return false
      const crossing = turns.some(other => {
        if (other === turn || other.band !== turn.band) return false
        const otherFrom = laneOf(other.from, candidate, lane)
        const otherTo = laneOf(other.to, candidate, lane)
        return otherFrom >= 0 && otherTo >= 0 && turnsCross({ from, to }, { from: otherFrom, to: otherTo })
      })
      if (crossing) return false
    }
    return true
  }
  const allocate = (run: LaneRun, minLane: number): void => {
    const widest = allocated.reduce((maximum, other) => Math.max(maximum, other.lane), minLane) + 2
    let lane = minLane
    while (lane <= widest && !fits(run, lane)) lane += 1
    if (lane > widest) {
      // No crossing-free lane exists for this merge; keep the runs apart at least.
      lane = minLane
      while (allocated.some(other => other.lane === lane && overlaps(other, run))) lane += 1
    }
    run.lane = lane
    allocated.push(run)
  }

  let colorIndex = 0
  const visit = (branch: Branch): void => {
    const run = runs.get(branch)
    if (run !== undefined && branch !== trunk) {
      const parentRun = branch.parent === undefined ? undefined : runs.get(branch.parent)
      allocate(run, run.minLane >= 0 ? run.minLane : Math.max(sideLaneFloor, (parentRun?.lane ?? -1) + 1))
      let color = 1 + (colorIndex % GRAPH_BRANCH_COLORS)
      if (color === parentRun?.color) color = 1 + (color % GRAPH_BRANCH_COLORS)
      run.color = color
      colorIndex += 1
    }
    // The sibling whose run ends first sits nearest its parent, so no sibling turns across another's lane.
    const runEnd = (child: Branch): number => runs.get(child)?.end ?? 0
    for (const child of [...branch.nested].sort((left, right) => runEnd(left) - runEnd(right))) visit(child)
  }
  if (trunk !== undefined) visit(trunk)
  for (const branch of branches.filter(candidate => candidate !== trunk && candidate.parent === undefined).sort(byGroupRecency)) visit(branch)
  for (const connector of connectors) {
    connector.run.color = connector.source.color
    allocate(connector.run, connector.run.minLane)
  }

  const runsByRow = order.map((): LaneRun[] => [])
  for (const run of allocated) {
    for (let index = Math.floor(run.start / 2); index <= Math.floor(run.end / 2) && index < order.length; index += 1) runsByRow[index]?.push(run)
  }
  const turnsByBand = new Map<number, LaneTurn[]>()
  for (const turn of turns) turnsByBand.set(turn.band, [...(turnsByBand.get(turn.band) ?? []), turn])

  return order.map((commitId, index): RevisionGraphRow => {
    const own = runOf(commitId)
    const commitLane = own?.lane ?? 0
    const color = own?.color ?? 0
    const top = 2 * index
    const rowRuns = runsByRow[index] ?? []
    const incoming: GraphLink[] =
      own !== undefined && own.start < top ? [{ fromLane: commitLane, toLane: commitLane, color, dashed: false, terminal: false }] : []
    const passing = rowRuns.flatMap((run): GraphLink[] => {
      if (run === own || run.start > top || run.end < top) return []
      const turn = turnsByBand.get(top + 1)?.find(candidate => candidate.from === run)
      return [{ fromLane: run.lane, toLane: turn?.to.lane ?? run.lane, color: run.color, dashed: false, terminal: false }]
    })
    const outgoing = (links.get(commitId) ?? []).map((link): GraphLink =>
      link.target === 'stub'
        ? { fromLane: commitLane, toLane: commitLane, color, dashed: link.dashed, terminal: true }
        : { fromLane: commitLane, toLane: link.target.lane, color, dashed: link.dashed, terminal: false },
    )
    const lanes = [commitLane, ...passing.flatMap(link => [link.fromLane, link.toLane]), ...outgoing.map(link => link.toLane)]
    return {
      commitId,
      commitLane,
      color,
      laneCount: Math.max(...lanes) + 1,
      incoming,
      passing,
      outgoing,
      topLanes: [...incoming, ...passing].map(link => ({ lane: link.fromLane, color: link.color })),
      bottomLanes: [
        ...passing.map(link => ({ lane: link.toLane, color: link.color })),
        ...outgoing.filter(link => !link.terminal).map(link => ({ lane: link.toLane, color: link.color })),
      ],
    }
  })
}
