import type { BacklogSummaryView } from './api.js'

export type BacklogSort = 'updated' | 'created'

export const backlogSortTime = (item: BacklogSummaryView, sort: BacklogSort): number => (sort === 'created' ? item.createdAt : item.lastActivityAt)

export const sortBacklogItems = (
  items: readonly BacklogSummaryView[],
  sort: BacklogSort,
  direction: 'ascending' | 'descending' = 'descending',
): BacklogSummaryView[] => {
  const multiplier = direction === 'ascending' ? 1 : -1
  return [...items].sort((left, right) => {
    const leftDate = sort === 'created' ? left.createdAt : left.lastActivityAt
    const rightDate = sort === 'created' ? right.createdAt : right.lastActivityAt
    return (leftDate - rightDate) * multiplier || (left.id - right.id) * multiplier
  })
}
