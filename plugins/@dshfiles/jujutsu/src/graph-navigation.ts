import type { Revision } from './api.js'
import { RevisionGraphModel } from './graph.js'

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
  /** Last content edit by commit id; revisions without one are dated by their author time. */
  readonly editTimes: ReadonlyMap<string, string>
  readonly view: GraphViewFilter | null
  readonly hidden: readonly HiddenGraphHistory[]
  readonly revealed: ReadonlySet<string>
}

export class GraphNavigationModel {
  static readonly mergeGraphRevisions = (...groups: readonly (readonly Revision[])[]): Revision[] => {
    const revisions = new Map<string, Revision>()
    for (const group of groups) {
      for (const revision of group) revisions.set(revision.commitId, revision)
    }
    return [...revisions.values()]
  }

  static readonly filterGraphRevisions = (revisions: readonly Revision[], filters: GraphFilters): Revision[] => {
    const hiddenIds = new Set(filters.hidden.flatMap(history => history.commitIds))
    return revisions.filter(revision => {
      if (filters.revealed.has(revision.commitId)) return true
      if (hiddenIds.has(revision.commitId)) return false
      if (filters.view !== null && !filters.view.commitIds.has(revision.commitId)) return false
      if (filters.mineOnly && !revision.mine && !revision.workingCopy) return false
      if (filters.hideImmutable && revision.immutable) return false
      if (filters.author && !revision.author.toLocaleLowerCase().includes(filters.author.toLocaleLowerCase())) return false
      if (!RevisionGraphModel.matchesRevisionSearch(revision, filters.text)) return false
      const timestamp = Date.parse(filters.editTimes.get(revision.commitId) ?? revision.authorTime)
      if (filters.fromDate && Number.isFinite(timestamp) && timestamp < Date.parse(filters.fromDate + 'T00:00:00')) return false
      if (filters.toDate && Number.isFinite(timestamp) && timestamp > Date.parse(filters.toDate + 'T23:59:59')) return false
      return true
    })
  }

  static readonly relationshipLabel = (relation: 'same' | 'ancestor' | 'descendant' | 'diverged' | 'no-common-ancestor'): string => {
    switch (relation) {
      case 'same':
        return 'Same revision'
      case 'ancestor':
        return 'Behind target'
      case 'descendant':
        return 'Ahead of target'
      case 'diverged':
        return 'Diverged'
      case 'no-common-ancestor':
        return 'Unrelated histories'
    }
  }
}
export const filterGraphRevisions = GraphNavigationModel.filterGraphRevisions
export const mergeGraphRevisions = GraphNavigationModel.mergeGraphRevisions
