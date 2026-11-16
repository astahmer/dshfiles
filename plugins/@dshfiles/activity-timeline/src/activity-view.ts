import { InboxPreview } from './inbox-preview.js'

/** A thread id as events record it; the page shows the thread's title in its place. */
const SESSION_ID = /session-[0-9a-f]{8}(?:-[0-9a-f]{4,12})*/giu

/**
 * A row's sentence as the user reads it: the thread's title where the Host recorded its id ("2× status change for
 * session-7b16…"), and the words of a pasted Markdown item without its markers.
 */
const summaryOf = (summary: string, threadTitle: (sessionId: string) => string): string => {
  const plain = InboxPreview.firstParagraph(summary)
  return (plain === '' ? summary : plain).replace(SESSION_ID, sessionId => threadTitle(sessionId))
}

export interface ActivityHeaderChip {
  readonly id: 'retained' | 'attention' | 'duplicates'
  readonly count: number
  /** `danger` is the tinted status trio (DESIGN.md): a status never takes a solid fill. */
  readonly tone: 'muted' | 'danger'
}

/** The header's counters: what is kept, then attention and duplicates only while there are some to count. */
const headerChips = (
  stats: { readonly retained: number; readonly attention: number; readonly duplicates: number } | undefined,
): readonly ActivityHeaderChip[] => {
  if (stats === undefined) return []
  return [
    { id: 'retained', count: stats.retained, tone: 'muted' },
    ...(stats.attention > 0 ? [{ id: 'attention', count: stats.attention, tone: 'danger' } as const] : []),
    ...(stats.duplicates > 0 ? [{ id: 'duplicates', count: stats.duplicates, tone: 'muted' } as const] : []),
  ]
}

export const ActivityView = { summaryOf, headerChips } as const
