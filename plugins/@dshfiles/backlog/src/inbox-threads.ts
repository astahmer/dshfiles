import type { BacklogSummaryView } from './api.js'

/** A thread from the sidebar's unread list that works on backlog items and stopped in a way worth a look. */
export const linkedThreadIds = (item: BacklogSummaryView): string[] => [...new Set(item.links.flatMap(link => (link.type === 'thread' ? [link.target] : [])))]

export interface InboxThread {
  readonly sessionId: string
  readonly version: number
  readonly reason: 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens'
  readonly at: number
  readonly title: string
  readonly items: readonly BacklogSummaryView[]
}

/**
 * Threads from the sidebar's unread list worth a place in the Inbox: only those linked to a backlog item, and with
 * `failures` only the ones whose last turn was blocked or errored, so the Inbox never repeats the sidebar's plain unread.
 */
export const inboxThreadsFrom = (input: {
  readonly mode: 'off' | 'failures' | 'all'
  readonly records: readonly {
    readonly sessionId: string
    readonly version: number
    readonly finishedAt: number | null
    readonly finishedReason: InboxThread['reason'] | null
  }[]
  readonly items: readonly BacklogSummaryView[]
  readonly titles: ReadonlyMap<string, string>
}): InboxThread[] => {
  if (input.mode === 'off') return []
  return input.records.flatMap(record => {
    const reason = record.finishedReason
    if (reason === null || (input.mode === 'failures' && reason !== 'blocked' && reason !== 'error')) return []
    const linked = input.items.filter(
      item => item.status !== 'done' && item.status !== 'dropped' && item.links.some(link => link.type === 'thread' && link.target === record.sessionId),
    )
    if (linked.length === 0) return []
    return [
      {
        sessionId: record.sessionId,
        version: record.version,
        reason,
        at: record.finishedAt ?? 0,
        title: input.titles.get(record.sessionId) ?? record.sessionId,
        items: linked,
      },
    ]
  })
}
