import type { Revision } from './api.js'

type SearchableRevision = Pick<Revision, 'description' | 'changeId' | 'commitId' | 'shortestChangeId' | 'bookmarks' | 'tags' | 'workspaces'>
type ParentRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable'>
type LayoutRevision = ParentRevision & Pick<Revision, 'bookmarks' | 'workspaces' | 'workingCopy' | 'divergent'>

/** What a lane carries, picked by the head revision that opened it. */
export type GraphTone = 'trunk' | 'current' | 'workspace' | 'divergent' | 'branch'

export interface GraphLink {
  readonly fromLane: number
  readonly toLane: number
  readonly tone: GraphTone
  readonly dashed: boolean
  /** The parent is outside the loaded graph: drawn as a short fading stub instead of a lane. */
  readonly terminal: boolean
}

export interface GraphLane {
  readonly lane: number
  readonly tone: GraphTone
}

/**
 * One row of the revision graph. Lines enter at the top edge, the node sits in the middle, and every
 * lane change happens in the lower half of the row, so all rows keep one height.
 */
export interface RevisionGraphRow {
  readonly commitId: string
  readonly commitLane: number
  readonly tone: GraphTone
  readonly laneCount: number
  /** Lanes that end at this node (usually only its own lane). */
  readonly incoming: readonly GraphLink[]
  /** Lanes of other revisions crossing this row, possibly moving left below the node. */
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

/**
 * Reorder revisions the way `jj log` draws its graph: each side branch sits directly above the commit it
 * forks from, and the branch holding the newest head stays on top. `jj log --no-graph` prints plain
 * index order instead, which scatters a branch's commits between unrelated ones and stretches its lane.
 */
export const groupRevisionsByBranch = <Row extends Pick<Revision, 'commitId' | 'parents'>>(revisions: readonly Row[]): Row[] => {
  const listed = new Set(revisions.map(revision => revision.commitId))
  const children = new Map<string, Row[]>()
  const unplacedParents = new Map<string, number>()
  const newestInSubtree = new Map<string, number>()
  for (const [index, revision] of revisions.entries()) {
    const parents = [...new Set(revision.parents.filter(parent => listed.has(parent)))]
    unplacedParents.set(revision.commitId, parents.length)
    for (const parent of parents) children.set(parent, [...(children.get(parent) ?? []), revision])
    newestInSubtree.set(revision.commitId, index)
  }
  // Children precede parents in jj's output, so one pass carries each head's index down to its ancestors.
  for (const revision of revisions) {
    const newest = newestInSubtree.get(revision.commitId) ?? 0
    for (const parent of revision.parents) {
      if (listed.has(parent)) newestInSubtree.set(parent, Math.min(newestInSubtree.get(parent) ?? newest, newest))
    }
  }
  const oldestBranchFirst = (left: Row, right: Row): number => (newestInSubtree.get(right.commitId) ?? 0) - (newestInSubtree.get(left.commitId) ?? 0)

  const bottomUp: Row[] = []
  const stack: { readonly row: Row; readonly children: readonly Row[]; next: number }[] = []
  const place = (row: Row): void => {
    bottomUp.push(row)
    stack.push({ row, children: [...(children.get(row.commitId) ?? [])].sort(oldestBranchFirst), next: 0 })
  }
  for (const root of revisions.filter(revision => unplacedParents.get(revision.commitId) === 0).sort(oldestBranchFirst)) {
    place(root)
    while (stack.length > 0) {
      const frame = stack.at(-1)
      const child = frame?.children[frame.next]
      if (frame === undefined || child === undefined) {
        stack.pop()
        continue
      }
      frame.next += 1
      const remaining = (unplacedParents.get(child.commitId) ?? 1) - 1
      unplacedParents.set(child.commitId, remaining)
      if (remaining === 0) place(child)
    }
  }
  const placed = new Set(bottomUp.map(row => row.commitId))
  return [...bottomUp.reverse(), ...revisions.filter(revision => !placed.has(revision.commitId))]
}

interface LaneSlot {
  readonly commitId: string
  readonly tone: GraphTone
  readonly visible: boolean
}

const TRUNK_BOOKMARKS = new Set(['main', 'master', 'trunk'])

const headTone = (revision: LayoutRevision): GraphTone => {
  if (revision.workingCopy) return 'current'
  if (revision.divergent) return 'divergent'
  if (revision.workspaces.length > 0) return 'workspace'
  return 'branch'
}

/**
 * The first-parent line kept straight in lane 0: from @ when @ is built on the trunk bookmark, otherwise
 * from that bookmark, otherwise from @ or the first listed revision.
 */
const trunkLine = (revisions: readonly LayoutRevision[], firstParent: ReadonlyMap<string, string>): ReadonlySet<string> => {
  const chainFrom = (commitId: string | undefined): string[] => {
    const chain: string[] = []
    const seen = new Set<string>()
    for (let current = commitId; current !== undefined && !seen.has(current); current = firstParent.get(current)) {
      seen.add(current)
      chain.push(current)
    }
    return chain
  }
  const bookmarked = revisions.find(revision => revision.bookmarks.some(name => TRUNK_BOOKMARKS.has(name)))
  const workingCopy = revisions.find(revision => revision.workingCopy)
  const fromWorkingCopy = chainFrom(workingCopy?.commitId)
  if (bookmarked === undefined) return new Set(fromWorkingCopy.length > 0 ? fromWorkingCopy : chainFrom(revisions[0]?.commitId))
  return new Set(fromWorkingCopy.includes(bookmarked.commitId) ? fromWorkingCopy : chainFrom(bookmarked.commitId))
}

const setLane = (lanes: Array<LaneSlot | null>, lane: number, slot: LaneSlot | null): void => {
  while (lanes.length < lane) lanes.push(null)
  lanes[lane] = slot
}

const freeLane = (lanes: readonly (LaneSlot | null)[], from: number): number => {
  for (let lane = from; lane < lanes.length; lane += 1) {
    if ((lanes[lane] ?? null) === null) return lane
  }
  return Math.max(lanes.length, from)
}

/**
 * Assign graph lanes in render order. The trunk line owns lane 0; a new head takes the leftmost free lane,
 * so short side branches sit next to the line they rejoin and cross nothing; a first parent continues
 * straight down; a parent already waiting in a lane to the right is pulled into the node's lane instead
 * of widening the graph; a parent outside the loaded graph ends in a stub rather than holding a lane.
 */
export const layoutRevisionGraph = (
  revisions: readonly LayoutRevision[],
  revisionsById: ReadonlyMap<string, ParentRevision>,
  hideImmutable: boolean,
): readonly RevisionGraphRow[] => {
  const listed = new Set(revisions.map(revision => revision.commitId))
  const parentLinks = new Map(revisions.map(revision => [revision.commitId, graphParentLinks(revision, revisionsById, hideImmutable, listed)]))
  const firstParent = new Map(
    revisions.flatMap(revision => {
      const parent = parentLinks.get(revision.commitId)?.[0]?.commitId
      return parent !== undefined && listed.has(parent) ? [[revision.commitId, parent] as const] : []
    }),
  )
  const trunk = trunkLine(revisions, firstParent)
  const trunkHead = revisions.find(revision => trunk.has(revision.commitId))
  const lanes: Array<LaneSlot | null> = trunkHead === undefined ? [] : [{ commitId: trunkHead.commitId, tone: 'trunk', visible: false }]
  const rows: RevisionGraphRow[] = []

  for (const revision of revisions) {
    const trunkReserved = lanes[0]?.tone === 'trunk' && !trunk.has(revision.commitId)
    const firstSideLane = trunkReserved ? 1 : 0
    const incomingLanes = lanes.flatMap((slot, lane) => (slot?.commitId === revision.commitId ? [lane] : []))
    const commitLane = incomingLanes[0] ?? freeLane(lanes, firstSideLane)
    const tone = lanes[commitLane]?.tone ?? (trunk.has(revision.commitId) ? 'trunk' : headTone(revision))
    const incoming = incomingLanes.flatMap((lane): GraphLink[] => {
      const slot = lanes[lane]
      return slot?.visible === true ? [{ fromLane: lane, toLane: commitLane, tone: slot.tone, dashed: false, terminal: false }] : []
    })

    const next = lanes.map(slot => (slot?.commitId === revision.commitId ? null : slot))
    const moves = new Map<number, number>()
    const outgoing = (parentLinks.get(revision.commitId) ?? []).map((parent, parentIndex): GraphLink => {
      const dashed = parent.hiddenParentCount > 0
      if (!listed.has(parent.commitId)) return { fromLane: commitLane, toLane: commitLane, tone, dashed, terminal: true }
      const waiting = next.findIndex(slot => slot?.commitId === parent.commitId)
      if (waiting >= 0) {
        const slot = next[waiting]
        const pullLeft = parentIndex === 0 && waiting > commitLane && (next[commitLane] ?? null) === null
        const target = pullLeft ? commitLane : waiting
        if (slot !== null && slot !== undefined) {
          next[waiting] = null
          setLane(next, target, { ...slot, visible: true, tone: target === 0 && trunk.has(parent.commitId) ? 'trunk' : slot.tone })
        }
        if (pullLeft) moves.set(waiting, commitLane)
        return { fromLane: commitLane, toLane: target, tone, dashed, terminal: false }
      }
      const parentOnTrunk = trunk.has(parent.commitId) && (next[0] ?? null) === null
      const target = parentOnTrunk
        ? 0
        : parentIndex === 0 && (next[commitLane] ?? null) === null
          ? commitLane
          : freeLane(next, Math.max(commitLane + 1, firstSideLane))
      setLane(next, target, { commitId: parent.commitId, tone: parentOnTrunk ? 'trunk' : parentIndex === 0 ? tone : 'branch', visible: true })
      return { fromLane: commitLane, toLane: target, tone, dashed, terminal: false }
    })

    const passing = lanes.flatMap((slot, lane): GraphLink[] =>
      slot === null || slot.commitId === revision.commitId || !slot.visible
        ? []
        : [{ fromLane: lane, toLane: moves.get(lane) ?? lane, tone: slot.tone, dashed: false, terminal: false }],
    )
    while (next.length > 0 && next.at(-1) === null) next.pop()
    const laneOf = (links: readonly GraphLink[], end: 'fromLane' | 'toLane'): GraphLane[] => links.map(link => ({ lane: link[end], tone: link.tone }))
    rows.push({
      commitId: revision.commitId,
      commitLane,
      tone,
      laneCount: Math.max(lanes.length, next.length, commitLane + 1),
      incoming,
      passing,
      outgoing,
      topLanes: [...laneOf(incoming, 'fromLane'), ...laneOf(passing, 'fromLane')],
      bottomLanes: [
        ...laneOf(passing, 'toLane'),
        ...laneOf(
          outgoing.filter(link => !link.terminal),
          'toLane',
        ),
      ],
    })
    lanes.splice(0, lanes.length, ...next)
  }

  return rows
}
