/**
 * The Filters panel's "Mark N shown as read / unread" (council round 34, B11): each verb counts the shown rows it would
 * change, so "Mark 2 shown as read" over five rows of which two are unread, and offers nothing at zero.
 */
export interface MarkShownCounts {
  /** Shown rows that are unread now: what "Mark N shown as read" changes. */
  readonly toRead: number
  /** Shown rows that are read now: what "Mark N shown as unread" changes. */
  readonly toUnread: number
}

export const markShownCounts = (shownIds: readonly string[], isUnread: (id: string) => boolean): MarkShownCounts => {
  const toRead = shownIds.filter(isUnread).length
  return { toRead, toUnread: shownIds.length - toRead }
}
