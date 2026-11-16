import { jobCategoryValues, type JobCategory } from './classify.js'
import type { JobBoard } from './types.js'

/** What the Jobs board shows when there is little or nothing to show. */
export class BoardView {
  /** A category filter is offered only for a category that has jobs, plus any selected one so its filter can be cleared. */
  static readonly shownCategories = (input: {
    readonly counts: JobBoard['categoryCounts'] | undefined
    readonly selected: readonly JobCategory[]
  }): readonly JobCategory[] => jobCategoryValues.filter(category => (input.counts?.[category] ?? 0) > 0 || input.selected.includes(category))

  /**
   * No job exists at all, as opposed to none matching the view. The board's counts cover every scope but follow the
   * search and category filters, so the answer is only known while neither is set.
   */
  static readonly nothingExists = (input: {
    readonly board: Pick<JobBoard, 'runningCount' | 'finishedCount'> | undefined
    readonly search: string
    readonly categories: readonly JobCategory[]
  }): boolean =>
    input.board !== undefined && input.search.trim() === '' && input.categories.length === 0 && input.board.runningCount + input.board.finishedCount === 0
}
