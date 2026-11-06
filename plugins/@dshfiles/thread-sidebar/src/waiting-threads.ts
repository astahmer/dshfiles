/**
 * The Inbox › Waiting threads page's shape: one row per thread, from the most urgent open inbox item about it.
 * `@dshfiles/thread-sidebar` already reads those items for its row emphasis (`inbox-signals`), so this module only
 * orders them: a thread appears once however many items point at it, and Done on the row is Done on that item.
 */
import type { InboxThreadSignal } from './thread-status.js'

export const WAITING_THREAD_TABS = ['needs-you', 'review'] as const
export type WaitingThreadTab = (typeof WAITING_THREAD_TABS)[number]

export interface WaitingThreadRow {
  readonly sessionId: string
  readonly signal: InboxThreadSignal
}

export interface WaitingThreadCounts {
  readonly 'needs-you': number
  readonly review: number
}

const rank = { blocking: 0, failed: 1, ready: 2 } as const

const tabOf = (signal: InboxThreadSignal): WaitingThreadTab => (signal.severity === 'ready' ? 'review' : 'needs-you')

export class WaitingThreads {
  /** Blocking first, then failed, then finished turns; newest within each, next to the thread list's own order. */
  static rows = (signals: ReadonlyMap<string, InboxThreadSignal>): readonly WaitingThreadRow[] =>
    [...signals]
      .map(([sessionId, signal]) => ({ sessionId, signal }))
      .sort((left, right) => rank[left.signal.severity] - rank[right.signal.severity] || right.signal.openedAt - left.signal.openedAt)

  static inTab = (rows: readonly WaitingThreadRow[], tab: WaitingThreadTab): readonly WaitingThreadRow[] => rows.filter(row => tabOf(row.signal) === tab)

  static countsOf = (rows: readonly WaitingThreadRow[]): WaitingThreadCounts => {
    const counts = { 'needs-you': 0, review: 0 }
    for (const row of rows) counts[tabOf(row.signal)] += 1
    return counts
  }
}
