import type { Revision } from './api.js'

type SearchableRevision = Pick<Revision, 'description' | 'changeId' | 'commitId' | 'shortestChangeId' | 'bookmarks' | 'tags' | 'workspaces'>

/** Ignore JJ's canonical trailing newline when comparing the editable description. */
const describeDraftChanged = (draft: string, current: string): boolean => draft.replace(/\n+$/, '') !== current.replace(/\n+$/, '')

/** jj prints change IDs in reverse hex (0-f → z-k), while the API carries normal hex. */
export const reverseHexChangeId = (changeId: string, length: number): string =>
  [...changeId.slice(0, length)].map(digit => String.fromCharCode('z'.charCodeAt(0) - Number.parseInt(digit, 16))).join('')

/** Search full IDs and the user-visible revision labels. */
export const matchesRevisionSearch = (revision: SearchableRevision, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  return [
    revision.description,
    revision.changeId,
    reverseHexChangeId(revision.changeId, revision.changeId.length),
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

/** Revision text helpers of the graph; the layout itself is `RevisionGraphLayout` from `@dshfiles/jj-integration/revision-graph`. */
export class RevisionGraphModel {
  static readonly describeDraftChanged = describeDraftChanged
  static readonly matchesRevisionSearch = matchesRevisionSearch
}
