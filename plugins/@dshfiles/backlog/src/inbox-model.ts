import type { BacklogSummaryView } from './api.js'
import { sortBacklogItems, type BacklogSort } from './backlog-sort.js'
import type { InboxThread } from './inbox-threads.js'

export type InboxFilter = 'all' | 'needs-input' | 'blocked' | 'suggestions'

export interface InboxRow {
  readonly item: BacklogSummaryView
  readonly threads: readonly InboxThread[]
  readonly hasItemReason: boolean
}

const hasInboxItemReason = (item: BacklogSummaryView): boolean => item.attention !== 'none' || item.proposal !== null

const itemMatches = (item: BacklogSummaryView, filter: InboxFilter): boolean => {
  if (!hasInboxItemReason(item)) return false
  if (filter === 'all') return true
  if (filter === 'suggestions') return item.proposal !== null
  if (filter === 'blocked') return item.attention === 'blocked' || item.attention === 'waiting'
  return item.attention === 'needs-input'
}

export const inboxRows = (input: {
  readonly items: readonly BacklogSummaryView[]
  readonly threads: readonly InboxThread[]
  readonly filter?: InboxFilter
  readonly sort?: BacklogSort
}): InboxRow[] => {
  const filter = input.filter ?? 'all'
  const items = new Map<number, BacklogSummaryView>()
  const threads = new Map<number, Map<string, InboxThread>>()
  for (const thread of input.threads) {
    for (const item of thread.items) {
      items.set(item.id, item)
      const linked = threads.get(item.id) ?? new Map<string, InboxThread>()
      linked.set(thread.sessionId, thread)
      threads.set(item.id, linked)
    }
  }
  for (const item of input.items) items.set(item.id, item)
  return sortBacklogItems([...items.values()], input.sort ?? 'updated').flatMap(item => {
    if (item.status === 'done' || item.status === 'dropped') return []
    const linked = [...(threads.get(item.id)?.values() ?? [])]
    const matchingThreads = linked.filter(thread => filter === 'all' || (filter === 'blocked' && thread.reason !== 'completed'))
    if (!itemMatches(item, filter) && matchingThreads.length === 0) return []
    return [{ item, threads: linked, hasItemReason: hasInboxItemReason(item) }]
  })
}
