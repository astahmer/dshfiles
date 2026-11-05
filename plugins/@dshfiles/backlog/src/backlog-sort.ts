import type { BacklogSummaryView } from './api.js'
import { BacklogItems } from './item.js'

/** `priority` is the ready-queue order: urgent first, no priority last, then the oldest. */
export type BacklogSort = 'updated' | 'created' | 'priority'

export const backlogSortTime = (item: BacklogSummaryView, sort: BacklogSort): number => (sort === 'updated' ? item.lastActivityAt : item.createdAt)

export const sortBacklogItems = (
  items: readonly BacklogSummaryView[],
  sort: BacklogSort,
  direction: 'ascending' | 'descending' = 'descending',
): BacklogSummaryView[] => {
  if (sort === 'priority')
    return [...items].sort(
      (left, right) =>
        BacklogItems.priorityRank(left.priority) - BacklogItems.priorityRank(right.priority) || left.createdAt - right.createdAt || left.id - right.id,
    )
  const multiplier = direction === 'ascending' ? 1 : -1
  return [...items].sort((left, right) => {
    const leftDate = sort === 'created' ? left.createdAt : left.lastActivityAt
    const rightDate = sort === 'created' ? right.createdAt : right.lastActivityAt
    return (leftDate - rightDate) * multiplier || (left.id - right.id) * multiplier
  })
}
