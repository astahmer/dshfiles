import type { ThreadStatusFilters } from './thread-view.js'

/**
 * An archived thread whose parent is gone from the corpus is storage, not navigation: the Archived section cannot
 * list it because it never becomes a root row, so the unfiltered list hides it and an explicit Archived filter brings
 * the whole unavailable branch back.
 */
const showsArchivedDetachedThreads = (statusFilters: ThreadStatusFilters): boolean => statusFilters.includes('archived')

export type DetachedGroupAction = 'archive' | 'restore'

/**
 * One header button covers the whole unavailable branch: archive every thread the user can see, or restore the branch
 * once the archived filter selects only archived threads.
 */
const detachedGroupAction = (threads: readonly { readonly archived: boolean }[]): DetachedGroupAction | null => {
  if (threads.length === 0) return null
  return threads.every(thread => thread.archived) ? 'restore' : 'archive'
}

export class DetachedThreadsModel {
  static readonly showsArchived = showsArchivedDetachedThreads
  static readonly actionFor = detachedGroupAction
}
