import type { GraphAncestor, GraphNodeRevision, GraphRevision, RevisionGraphRow } from '@dshfiles/jj-integration/revision-graph'
import { RevisionGraphLayout } from '@dshfiles/jj-integration/revision-graph'
import type { RevisionGraphBase, RevisionReview } from './api.js'

/** One row of the review graph: a reviewed revision, or a parent the selection sits on outside the review. */
export type ReviewGraphEntry =
  | {
      readonly kind: 'revision'
      readonly revision: RevisionReview
      readonly node: GraphRevision & GraphNodeRevision
      readonly layout: RevisionGraphRow
      /** Revisions left out below this one, summed over its links; the row after it says so. */
      readonly hiddenBelow: number
      /** Parents the Host could not place (its graph read was too large): an open edge and a row saying so. */
      readonly uncountedBelow: boolean
    }
  | {
      readonly kind: 'base'
      readonly base: RevisionGraphBase
      readonly node: GraphRevision & GraphNodeRevision
      readonly layout: RevisionGraphRow
    }

const ELIDED_PREFIX = 'elided:'

const nodeOf = (input: {
  readonly commitId: string
  readonly parents: readonly string[]
  readonly shortestChangeId: string
  readonly bookmarks: readonly string[]
  readonly immutable?: boolean | undefined
  readonly conflict?: boolean | undefined
  readonly divergent?: boolean | undefined
  readonly workingCopy?: boolean | undefined
}): GraphRevision & GraphNodeRevision => ({
  commitId: input.commitId,
  parents: input.parents,
  shortestChangeId: input.shortestChangeId,
  bookmarks: input.bookmarks,
  immutable: input.immutable ?? false,
  conflict: input.conflict ?? false,
  divergent: input.divergent ?? false,
  workingCopy: input.workingCopy ?? false,
  workspaces: [],
})

/**
 * The review's revisions as graph rows, newest first like the Jujutsu panel. A link across revisions the review left
 * out goes through a placeholder parent that is never listed, so the layout draws it as one dashed edge; the parents a
 * run sits on (the bookmark it branched from) close the graph as muted rows. A Host from before the graph sends no
 * links, and the rows then stand unconnected.
 */
const entries = (revisions: readonly RevisionReview[]): readonly ReviewGraphEntry[] => {
  const byId = new Map<string, GraphAncestor>()
  const listed: (GraphRevision & GraphNodeRevision)[] = []
  const reviewed = new Map<string, RevisionReview>()
  const bases = new Map<string, RevisionGraphBase>()
  const hiddenBelow = new Map<string, number>()
  const uncountedBelow = new Set<string>()
  for (const revision of [...revisions].reverse()) {
    const parents: string[] = []
    let hidden = 0
    for (const link of revision.links ?? []) {
      if (link.hidden === 0) {
        parents.push(link.commitId)
        continue
      }
      const placeholder = `${ELIDED_PREFIX}${revision.commitId}:${link.commitId}`
      byId.set(placeholder, { commitId: placeholder, parents: [link.commitId], shortestChangeId: '…', immutable: false })
      parents.push(placeholder)
      hidden += link.hidden
    }
    for (const base of revision.base ?? []) {
      parents.push(base.commitId)
      if (!bases.has(base.commitId)) bases.set(base.commitId, base)
    }
    // An unplaced parent stays out of `byId`, so the layout ends its edge in a short open stub, not on a base row.
    for (const commitId of revision.unplaced ?? []) parents.push(commitId)
    if ((revision.unplaced ?? []).length > 0) uncountedBelow.add(revision.commitId)
    const node = nodeOf({
      commitId: revision.commitId,
      parents,
      shortestChangeId: revision.shortChangeId,
      bookmarks: revision.bookmarks ?? [],
      immutable: revision.immutable,
      conflict: revision.conflict,
      divergent: revision.divergent,
      workingCopy: revision.workingCopy,
    })
    listed.push(node)
    byId.set(node.commitId, node)
    reviewed.set(node.commitId, revision)
    hiddenBelow.set(node.commitId, hidden)
  }
  for (const base of bases.values()) {
    if (reviewed.has(base.commitId)) continue
    const node = nodeOf({ commitId: base.commitId, parents: [], shortestChangeId: base.shortChangeId, bookmarks: base.bookmarks, immutable: true })
    listed.push(node)
    byId.set(node.commitId, node)
  }
  const nodes = new Map(listed.map(node => [node.commitId, node]))
  return RevisionGraphLayout.layoutRevisionGraph(listed, byId, false).flatMap((layout): ReviewGraphEntry[] => {
    const node = nodes.get(layout.commitId)
    if (node === undefined) return []
    const revision = reviewed.get(layout.commitId)
    if (revision !== undefined) {
      return [
        { kind: 'revision', revision, node, layout, hiddenBelow: hiddenBelow.get(layout.commitId) ?? 0, uncountedBelow: uncountedBelow.has(layout.commitId) },
      ]
    }
    const base = bases.get(layout.commitId)
    return base === undefined ? [] : [{ kind: 'base', base, node, layout }]
  })
}

/** A change id split for display: the shortest unique prefix and the dimmed rest. */
export interface ChangeIdParts {
  readonly prefix: string
  readonly rest: string
}

/** The change id with its shortest unique prefix apart from the rest, as jj prints it; at most 8 characters. */
const changeIdParts = (revision: Pick<RevisionReview, 'changeId' | 'shortChangeId'>): ChangeIdParts => {
  const prefix = revision.shortChangeId
  const rest = revision.changeId.startsWith(prefix) ? revision.changeId.slice(prefix.length, Math.max(prefix.length, 8)) : ''
  return { prefix, rest }
}

/** jj's root commit, all zeros: the base of a selection that starts at the repository's first revision. */
const isRoot = (base: Pick<RevisionGraphBase, 'commitId'>): boolean => /^0+$/u.test(base.commitId)

export class ReviewGraphModel {
  static readonly entries = entries
  static readonly isRoot = isRoot
  static readonly changeIdParts = changeIdParts
}
