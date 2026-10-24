import type { Revision } from './api.js'

type LinkedRevision = Pick<Revision, 'commitId' | 'parents' | 'workingCopy' | 'immutable' | 'empty' | 'description'>

export interface SourceControlGroup<Row extends LinkedRevision> {
  readonly depth: number
  readonly revision: Row
  readonly parent: Row | null
  readonly child: Row | null
}

export class SourceControlModel {
  /** Walk @, @-1 … @-N along first parents, keeping each group's neighbours for file moves. */
  static readonly sourceControlGroups = <Row extends LinkedRevision>(revisions: readonly Row[], ancestorCount: number): SourceControlGroup<Row>[] => {
    const byId = new Map(revisions.map(revision => [revision.commitId, revision]))
    const workingCopy = revisions.find(revision => revision.workingCopy)
    if (workingCopy === undefined) return []
    const chain: Row[] = [workingCopy]
    let cursor = workingCopy
    while (chain.length <= ancestorCount) {
      const parentId = cursor.parents[0]
      const parent = parentId === undefined ? undefined : byId.get(parentId)
      if (parent === undefined) break
      chain.push(parent)
      cursor = parent
    }
    return chain.map((revision, depth) => {
      const parentId = revision.parents[0]
      return {
        depth,
        revision,
        parent: parentId === undefined ? null : (byId.get(parentId) ?? null),
        child: chain[depth - 1] ?? null,
      }
    })
  }

  /** Mutable, empty, single-parent ancestors of @ that `jj abandon` can drop safely. */
  static readonly emptyAncestorCandidates = <Row extends LinkedRevision>(revisions: readonly Row[]): Row[] => {
    const byId = new Map(revisions.map(revision => [revision.commitId, revision]))
    const workingCopy = revisions.find(revision => revision.workingCopy)
    if (workingCopy === undefined) return []
    const seen = new Set<string>()
    const queue = [...workingCopy.parents]
    const candidates: Row[] = []
    while (queue.length > 0) {
      const commitId = queue.shift()
      if (commitId === undefined || seen.has(commitId)) continue
      seen.add(commitId)
      const revision = byId.get(commitId)
      if (revision === undefined || revision.immutable) continue
      if (revision.empty && revision.parents.length === 1) candidates.push(revision)
      queue.push(...revision.parents)
    }
    return candidates.slice(0, 50)
  }

  /** The branch a rebase moves: the source and every visible descendant. */
  static readonly descendantCommitIds = (
    revisions: readonly { readonly commitId: string; readonly parents: readonly string[] }[],
    sourceId: string,
  ): ReadonlySet<string> => {
    const children = new Map<string, string[]>()
    for (const revision of revisions) {
      for (const parent of revision.parents) children.set(parent, [...(children.get(parent) ?? []), revision.commitId])
    }
    const result = new Set<string>([sourceId])
    const queue = [sourceId]
    while (queue.length > 0) {
      const next = queue.pop()
      for (const child of children.get(next ?? '') ?? []) {
        if (result.has(child)) continue
        result.add(child)
        queue.push(child)
      }
    }
    return result
  }
}
export const descendantCommitIds = SourceControlModel.descendantCommitIds
export const emptyAncestorCandidates = SourceControlModel.emptyAncestorCandidates
