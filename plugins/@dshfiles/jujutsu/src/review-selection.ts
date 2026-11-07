import type { Revision } from './api.js'
import { reverseHexChangeId } from './graph.js'

/**
 * The id a combined review should read a selected row by. A change id keeps following a revision that gets rewritten
 * while its review is open; a divergent row needs its commit id, because its change id names several commits.
 */
const reviewId = (revision: Pick<Revision, 'changeId' | 'commitId' | 'divergent'>): string =>
  revision.divergent ? revision.commitId : reverseHexChangeId(revision.changeId, revision.changeId.length)

/** The selected rows, in graph order, as review ids. */
const reviewIds = (input: { readonly selected: readonly string[]; readonly revisions: readonly Revision[] }): readonly string[] => {
  const selected = new Set(input.selected)
  return input.revisions.filter(revision => selected.has(revision.commitId)).map(reviewId)
}

export const ReviewSelectionModel = { reviewId, reviewIds }
