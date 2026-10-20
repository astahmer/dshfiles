import type { BacklogSummaryView } from './api.js'
import type { BacklogStatus } from './item.js'

/** Status reads for the feed: an empty selection means "All", and picks are additive. */
export class FeedStatus {
  static filter(items: readonly BacklogSummaryView[], statuses: readonly BacklogStatus[]): BacklogSummaryView[] {
    return statuses.length === 0 ? [...items] : items.filter(item => statuses.includes(item.status))
  }

  static counts(items: readonly BacklogSummaryView[]) {
    const counts = { inbox: 0, todo: 0, doing: 0, done: 0, dropped: 0 } satisfies Record<BacklogStatus, number>
    for (const item of items) counts[item.status] += 1
    return counts
  }

  /** Adding a status keeps the others, so several can be read together; removing the last one falls back to All. */
  static toggle(statuses: readonly BacklogStatus[], status: BacklogStatus): BacklogStatus[] {
    return statuses.includes(status) ? statuses.filter(other => other !== status) : [...statuses, status]
  }
}
