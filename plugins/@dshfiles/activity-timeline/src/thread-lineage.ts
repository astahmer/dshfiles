/**
 * The inbox shows the thread the user acts on. A subagent Session is not that thread: its parent started the work, so a
 * row that opens the subagent hands the user something to read and nothing to drive. An item about a subagent therefore
 * lists as its top-level ancestor. The stored item keeps its own subject, so Done and a provider verb still name the
 * Session they were published about.
 */
import { Effect } from 'effect'
import type { AttentionItem, AttentionSubject } from './attention-api.js'

/** The stored Session header fields the rollup needs; the persistence `stat` reads them without the event log. */
export interface ThreadLineageHeader {
  readonly origin?: 'subagent'
  readonly parentSessionId?: string
}

const sessionSubject = (id: string): AttentionSubject => ({ kind: 'session', id })

/** DSH bounds delegation depth itself; a longer chain is corrupt data, so the walk stops at the deepest real parent. */
const MAX_LINEAGE_DEPTH = 8

export class ThreadLineageModel {
  /**
   * The thread a user acts on: the top-level ancestor of a subagent Session, or the Session itself. A header that cannot
   * be read (a Session another Host owns, a pruned row) ends the walk at the last id that existed, so an item never
   * points at a thread the reader cannot resolve.
   */
  static readonly rootOf = (options: {
    readonly sessionId: string
    readonly headerOf: (sessionId: string) => Effect.Effect<ThreadLineageHeader | undefined>
  }): Effect.Effect<string> =>
    Effect.gen(function* () {
      let current = options.sessionId
      let lastExisting = options.sessionId
      for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
        const header = yield* options.headerOf(current)
        if (header === undefined) return lastExisting
        lastExisting = current
        if (header.origin !== 'subagent' || header.parentSessionId === undefined) return current
        current = header.parentSessionId
      }
      return current
    })

  /** Every Session subject replaced by its root thread; the label goes too, because a reader resolves that title. */
  static readonly withParentSubjects = (options: {
    readonly items: readonly AttentionItem[]
    readonly rootOf: (sessionId: string) => Effect.Effect<string>
  }): Effect.Effect<readonly AttentionItem[]> =>
    Effect.gen(function* () {
      if (options.items.length === 0) return options.items
      const roots = new Map<string, string>()
      const rootOf = (sessionId: string): Effect.Effect<string> => {
        const cached = roots.get(sessionId)
        return cached === undefined
          ? Effect.tap(options.rootOf(sessionId), root =>
              Effect.sync(() => {
                roots.set(sessionId, root)
              }),
            )
          : Effect.succeed(cached)
      }
      const rolled = yield* Effect.forEach(
        options.items,
        item => {
          if (item.subject.kind !== 'session') return Effect.succeed(item)
          const subjectId = item.subject.id
          return Effect.map(rootOf(subjectId), root => (root === subjectId ? item : { ...item, subject: sessionSubject(root) }))
        },
        { concurrency: 1 },
      )
      return rolled
    })
}
