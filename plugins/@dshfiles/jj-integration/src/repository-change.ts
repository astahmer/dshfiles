/**
 * The one "the repository moved" signal: a land, rebase or queue change rewrote jj history, so every view that reads
 * the thread inventory (the thread list's "N to land", the jj panel, the changes chips) refetches now instead of on
 * its next poll. A dshx module, so another plugin that lands through jj-integration (diffs-review's Land card) sends
 * the same event instead of restating its name.
 */
export const REPOSITORY_CHANGED_EVENT = 'dshfiles:jj-changed'

export const announceRepositoryChange = (): void => {
  window.dispatchEvent(new CustomEvent(REPOSITORY_CHANGED_EVENT))
}
