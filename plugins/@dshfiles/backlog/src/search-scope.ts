/**
 * Typing in the backlog search narrows the view the user is on; submitting it (Enter) opens the ranked results view.
 * `submitted` only counts while there is a query, so clearing the input always returns to the plain view.
 */
export interface SearchScope {
  readonly query: string
  readonly submitted: boolean
}

export const SearchScopes = {
  idle: { query: '', submitted: false } satisfies SearchScope,
  showsResults: (scope: SearchScope): boolean => scope.submitted && scope.query.trim() !== '',
  filtersView: (scope: SearchScope): boolean => !scope.submitted && scope.query.trim() !== '',
  type: (scope: SearchScope, query: string): SearchScope => ({ query, submitted: query.trim() === '' ? false : scope.submitted }),
  submit: (scope: SearchScope): SearchScope => ({ query: scope.query, submitted: scope.query.trim() !== '' }),
  /** Picking a view, or applying a saved one, keeps the query as a filter on that view. */
  leaveResults: (scope: SearchScope): SearchScope => ({ query: scope.query, submitted: false }),
  /** Project keys that hold at least one matching item, in the Projects view's key space (no project is ''). */
  matchingProjects: (items: readonly { readonly project: string | null }[]): ReadonlySet<string> => new Set(items.map(item => item.project ?? '')),
}
