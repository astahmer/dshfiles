/**
 * The phone thread list's one scope button (council round 10 B1): the search and this button share one 44px row, and
 * its menu holds the project and the status views. The button names the current scope in a word or two.
 */
export interface ThreadListScopeInput {
  /** The active view or filter when it is not the default one (All threads, no filter), else null. */
  readonly view: string | null
  /** The project picked, or null for All projects. */
  readonly project: string | null
  /** The default scope's word ("All"). */
  readonly all: string
}

export class ThreadListScope {
  /** The non-default parts, view first ("Needs you · billing-api"), or the default word. */
  static label(input: ThreadListScopeInput): string {
    const parts = [input.view, input.project].filter((part): part is string => part !== null && part.length > 0)
    return parts.length === 0 ? input.all : parts.join(' · ')
  }

  /** A narrowed scope shows a tinted dot on the button, so a list that hides threads says so at a glance. */
  static narrowed(input: ThreadListScopeInput): boolean {
    return (input.view !== null && input.view.length > 0) || (input.project !== null && input.project.length > 0)
  }
}
