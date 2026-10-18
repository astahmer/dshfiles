/** How another thread points back at the thread a menu was opened on. */
export type ThreadReferenceRelation = 'fork' | 'subagent' | 'mention'

/** One thread that references the thread a menu was opened on. */
export interface ThreadReferenceRow {
  readonly sessionId: string
  readonly title?: string
  readonly updatedAt?: number
  readonly relation: ThreadReferenceRelation
}

export interface ThreadReferencesResult {
  readonly sessionId: string
  readonly references: readonly ThreadReferenceRow[]
  /** Rows that exist but did not fit the requested limit. */
  readonly omitted: number
  /** The content search that finds mentioning threads failed; only lineage is present. */
  readonly degraded: boolean
}

/** One visible thread as the reference lookup reads it. */
export interface ThreadReferenceThread {
  readonly sessionId: string
  readonly updatedAt?: number
  readonly parentSessionId: string | null
  readonly origin?: 'subagent'
}

/** One thread whose indexed message pulled the target in as referenced context. */
export interface ThreadReferenceMention {
  readonly sessionId: string
}

export interface ThreadReferencesMerge {
  readonly sessionId: string
  readonly threads: readonly ThreadReferenceThread[]
  readonly mentions: readonly ThreadReferenceMention[]
  readonly limit: number
  readonly degraded: boolean
}

const newestFirst = (left: ThreadReferenceRow, right: ThreadReferenceRow): number =>
  (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0)

export class ThreadReferencesModel {
  static readonly defaultLimit = 8
  static readonly maxLimit = 20

  /**
   * The bare session id, the form a message recorded when the mentioned thread had no title yet. A mention of a
   * titled thread serializes only its label, so the lookup tries the canonical `dsh-session:` payload first and
   * keeps this as the fallback.
   */
  static readonly mentionQuery = (sessionId: string): string => sessionId.replace(/^session-/u, '')

  /** Forked and subagent children first, then the threads that pulled this one in as context. */
  static readonly merge = ({ sessionId, threads, mentions, limit, degraded }: ThreadReferencesMerge): ThreadReferencesResult => {
    const threadById = new Map(threads.map(thread => [thread.sessionId, thread]))
    const children: ThreadReferenceRow[] = []
    for (const thread of threads) {
      if (thread.sessionId === sessionId || thread.parentSessionId !== sessionId) continue
      children.push({
        sessionId: thread.sessionId,
        relation: thread.origin === 'subagent' ? 'subagent' : 'fork',
        ...(thread.updatedAt === undefined ? undefined : { updatedAt: thread.updatedAt }),
      })
    }
    const known = new Set([sessionId, ...children.map(child => child.sessionId)])
    const mentioning: ThreadReferenceRow[] = []
    for (const mention of mentions) {
      if (known.has(mention.sessionId)) continue
      known.add(mention.sessionId)
      const updatedAt = threadById.get(mention.sessionId)?.updatedAt
      mentioning.push({ sessionId: mention.sessionId, relation: 'mention', ...(updatedAt === undefined ? undefined : { updatedAt }) })
    }
    const ordered = [...children.sort(newestFirst), ...mentioning.sort(newestFirst)]
    return { sessionId, references: ordered.slice(0, limit), omitted: Math.max(0, ordered.length - limit), degraded }
  }

  static readonly withTitles = (rows: readonly ThreadReferenceRow[], titles: ReadonlyMap<string, string>): readonly ThreadReferenceRow[] =>
    rows.map(row => {
      const title = titles.get(row.sessionId)
      return title === undefined ? row : { ...row, title }
    })
}
