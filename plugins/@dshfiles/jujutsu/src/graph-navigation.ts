import type { Revision } from './api.js'
import { matchesRevisionSearch } from './graph.js'

export interface GraphViewFilter {
  readonly kind: 'history' | 'difference' | 'connection'
  readonly label: string
  readonly commitIds: ReadonlySet<string>
  readonly revisions: readonly Revision[]
  readonly truncated: boolean
}

export interface HiddenGraphHistory {
  readonly commitId: string
  readonly label: string
  readonly commitIds: readonly string[]
  readonly truncated: boolean
}

export interface GraphFilters {
  readonly mineOnly: boolean
  readonly hideImmutable: boolean
  readonly author: string
  readonly text: string
  readonly fromDate: string
  readonly toDate: string
  readonly view: GraphViewFilter | null
  readonly hidden: readonly HiddenGraphHistory[]
  readonly revealed: ReadonlySet<string>
}

export const mergeGraphRevisions = (...groups: readonly (readonly Revision[])[]): Revision[] => {
  const revisions = new Map<string, Revision>()
  for (const group of groups) {
    for (const revision of group) revisions.set(revision.commitId, revision)
  }
  return [...revisions.values()]
}

export const filterGraphRevisions = (revisions: readonly Revision[], filters: GraphFilters): Revision[] => {
  const hiddenIds = new Set(filters.hidden.flatMap(history => history.commitIds))
  return revisions.filter(revision => {
    if (filters.revealed.has(revision.commitId)) return true
    if (hiddenIds.has(revision.commitId)) return false
    if (filters.view !== null && !filters.view.commitIds.has(revision.commitId)) return false
    if (filters.mineOnly && !revision.mine && !revision.workingCopy) return false
    if (filters.hideImmutable && revision.immutable) return false
    if (filters.author && !revision.author.toLocaleLowerCase().includes(filters.author.toLocaleLowerCase())) return false
    if (!matchesRevisionSearch(revision, filters.text)) return false
    const timestamp = Date.parse(revision.authorTime)
    if (filters.fromDate && Number.isFinite(timestamp) && timestamp < Date.parse(filters.fromDate + 'T00:00:00')) return false
    if (filters.toDate && Number.isFinite(timestamp) && timestamp > Date.parse(filters.toDate + 'T23:59:59')) return false
    return true
  })
}

export const relationshipLabel = (relation: 'same' | 'ancestor' | 'descendant' | 'diverged' | 'no-common-ancestor'): string => {
  switch (relation) {
    case 'same':
      return 'Same revision'
    case 'ancestor':
      return 'Selected is ancestor of target'
    case 'descendant':
      return 'Selected descends from target'
    case 'diverged':
      return 'Diverged'
    case 'no-common-ancestor':
      return 'No shared ancestor'
  }
}
