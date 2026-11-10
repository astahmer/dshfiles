import { describe, expect, it } from 'vitest'
import type { Revision } from './api.js'
import { ReviewSelectionModel } from './review-selection.js'

const row = (commitId: string, changeId: string, divergent = false): Revision =>
  // SAFETY: the model reads only these three fields of a revision.
  ({ commitId, changeId, divergent }) as Revision

describe('ReviewSelectionModel', () => {
  it('reads a row by the change id jj prints, and a divergent row by its commit', () => {
    expect(ReviewSelectionModel.reviewId(row('c1', '0a8b'))).toBe('zpro')
    expect(ReviewSelectionModel.reviewId(row('c2', '0a8b', true))).toBe('c2')
  })

  it('keeps graph order, not selection order, and skips a row that left the graph', () => {
    const revisions = [row('c1', '00'), row('c2', '11'), row('c3', '22')]
    expect(ReviewSelectionModel.reviewIds({ selected: ['c3', 'gone', 'c1'], revisions })).toEqual(['zz', 'xx'])
  })
})
