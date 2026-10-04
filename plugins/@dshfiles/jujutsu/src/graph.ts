import type { Revision } from './api.js'

type SearchableRevision = Pick<Revision, 'description' | 'changeId' | 'commitId' | 'shortestChangeId' | 'bookmarks' | 'tags' | 'workspaces'>
type ParentRevision = Pick<Revision, 'commitId' | 'parents' | 'shortestChangeId' | 'immutable'>

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
