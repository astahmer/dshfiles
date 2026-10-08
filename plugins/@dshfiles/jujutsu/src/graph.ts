import type { Revision } from './api.js'

type SearchableRevision = Pick<Revision, 'description' | 'changeId' | 'commitId' | 'shortestChangeId' | 'bookmarks' | 'tags' | 'workspaces'>
type ParentRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable'>

export interface GraphLaneEdge {
  readonly fromLane: number
  readonly toLane: number
  readonly dashed: boolean
}

export interface RevisionGraphRow {
  readonly commitId: string
  readonly commitLane: number
  readonly incoming: boolean
  readonly laneCount: number
  readonly topLanes: readonly number[]
  readonly bottomLanes: readonly number[]
  readonly edges: readonly GraphLaneEdge[]
}

export interface GraphParentLink {
  readonly commitId: string
  readonly label: string
  readonly hiddenImmutableCount: number
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

/** Collapse hidden immutable parents into explicit ancestry links to visible ancestors. */
export const graphParentLinks = (revision: ParentRevision, revisionsById: ReadonlyMap<string, ParentRevision>, hideImmutable: boolean): GraphParentLink[] => {
  const links = new Map<string, GraphParentLink>()
  const visit = (commitId: string, hiddenImmutableCount: number, seen: ReadonlySet<string>): void => {
    const parent = revisionsById.get(commitId)
    if (parent === undefined) {
      links.set(commitId, { commitId, label: commitId.slice(0, 8), hiddenImmutableCount, terminal: false })
      return
    }
    if (!hideImmutable || !parent.immutable) {
      links.set(commitId, { commitId, label: parent.shortestChangeId, hiddenImmutableCount, terminal: false })
      return
    }
    if (seen.has(commitId)) return
    const nextSeen = new Set(seen).add(commitId)
    if (parent.parents.length === 0) {
      links.set(commitId, {
        commitId,
        label: parent.shortestChangeId,
        hiddenImmutableCount: hiddenImmutableCount + 1,
        terminal: true,
      })
      return
    }
    for (const nextParent of parent.parents) visit(nextParent, hiddenImmutableCount + 1, nextSeen)
  }
  for (const parentId of revision.parents) visit(parentId, 0, new Set([revision.commitId]))
  return [...links.values()]
}

const firstOpenLane = (lanes: readonly (string | null)[], startLane: number): number => {
  for (let lane = startLane; lane < lanes.length; lane += 1) {
    if (lanes[lane] === null) return lane
  }
  return Math.max(lanes.length, startLane)
}

/** Assign stable graph lanes in the order the revision list is rendered. */
export const layoutRevisionGraph = (
  revisions: readonly Revision[],
  revisionsById: ReadonlyMap<string, ParentRevision>,
  hideImmutable: boolean,
): readonly RevisionGraphRow[] => {
  const lanes: Array<string | null> = []
  const rows: RevisionGraphRow[] = []

  for (const revision of revisions) {
    let commitLane = lanes.indexOf(revision.commitId)
    const incoming = commitLane >= 0
    if (commitLane < 0) {
      const rightmostActiveLane = lanes.reduce((rightmost, commitId, lane) => (commitId === null ? rightmost : lane), -1)
      commitLane = firstOpenLane(lanes, rightmostActiveLane < 0 ? 0 : rightmostActiveLane + 1)
      lanes[commitLane] = revision.commitId
    }

    const topLanes = lanes.flatMap((commitId, lane) => (commitId === null || lane === commitLane ? [] : [lane]))
    const nextLanes = [...lanes]
    nextLanes[commitLane] = null
    const parentLinks = graphParentLinks(revision, revisionsById, hideImmutable)
    const edges = parentLinks.map((parent, parentIndex): GraphLaneEdge => {
      let targetLane = nextLanes.indexOf(parent.commitId)
      if (targetLane < 0) {
        targetLane = parentIndex === 0 && nextLanes[commitLane] === null ? commitLane : firstOpenLane(nextLanes, commitLane + 1)
        nextLanes[targetLane] = parent.commitId
      }
      return { fromLane: commitLane, toLane: targetLane, dashed: parent.hiddenImmutableCount > 0 }
    })

    while (nextLanes.length > 0 && nextLanes.at(-1) === null) nextLanes.pop()
    const bottomLanes = nextLanes.flatMap((commitId, lane) => (commitId === null || edges.some(edge => edge.toLane === lane) ? [] : [lane]))
    rows.push({
      commitId: revision.commitId,
      commitLane,
      incoming,
      laneCount: Math.max(lanes.length, nextLanes.length, commitLane + 1),
      topLanes,
      bottomLanes,
      edges,
    })
    lanes.splice(0, lanes.length, ...nextLanes)
  }

  return rows
}
