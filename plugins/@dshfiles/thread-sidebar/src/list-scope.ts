/**
 * The phone thread list's one scope button (council round 10 B1): the search and this button share one 44px row, and
 * its menu holds the project and the status views. It reads "Filters", or the project when one is picked, with a count
 * of the filters on (council round 11 B2): a bare "All" did not say the button filters.
 */
export interface ThreadListScopeInput {
  /** How many filters narrow the list besides the project (`filterCount`), 0 at the default view. */
  readonly filterCount: number
  /** The project picked, or null for All projects. */
  readonly project: string | null
  /** The button's word when no project is picked ("Filters"). */
  readonly filters: string
}

export class ThreadListScope {
  /** The project picked, else the button's word. */
  static label(input: ThreadListScopeInput): string {
    return input.project !== null && input.project.length > 0 ? input.project : input.filters
  }

  /** The count beside the label, or null when no filter is on. */
  static count(input: ThreadListScopeInput): number | null {
    return input.filterCount > 0 ? input.filterCount : null
  }

  /** A narrowed scope (a filter or a project) hides threads; the button says so. */
  static narrowed(input: ThreadListScopeInput): boolean {
    return input.filterCount > 0 || (input.project !== null && input.project.length > 0)
  }

  /**
   * The filters on: each status or source filter counts once; a view other than All threads that sets neither (a
   * sort or grouping preset) still narrows the list, so it counts as one.
   */
  static filterCount(input: { readonly filtered: boolean; readonly filterLabels: number }): number {
    return input.filtered ? Math.max(1, input.filterLabels) : 0
  }
}
