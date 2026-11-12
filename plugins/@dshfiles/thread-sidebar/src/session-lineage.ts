import { Context, Effect, Layer, Option } from 'effect'
import { SidebarHost } from './sidebar-host-promise.js'

/** The stored Session header fields the roll-up needs: whether a Session is a subagent, and whose. */
export interface LineageHeader {
  readonly subagent: boolean
  readonly parentSessionId: string | undefined
}

/** DSH bounds delegation depth itself; a longer chain is corrupt data, so the walk stops at the deepest real parent. */
const MAX_LINEAGE_DEPTH = 8
/** Headers kept in memory; a Session's origin and parent never change, so an entry is never stale, only old. */
const MAX_CACHED_HEADERS = 4000

/**
 * The thread a user acts on: the top-level ancestor of a subagent Session, or the Session itself. A header that cannot
 * be read ends the walk at the last Session that existed, so a roll-up never points at a thread nobody can open.
 */
const rootOf = (options: {
  readonly sessionId: string
  readonly headerOf: (sessionId: string) => Effect.Effect<LineageHeader | undefined>
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    let current = options.sessionId
    let lastExisting = options.sessionId
    for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
      const header = yield* options.headerOf(current)
      if (header === undefined) return lastExisting
      lastExisting = current
      if (!header.subagent || header.parentSessionId === undefined) return current
      current = header.parentSessionId
    }
    return current
  })

/**
 * Subagent lineage of stored Sessions, read from the persisted header only (never the event log) and cached, so the
 * inbox provider can roll a subagent's finished turn into its parent thread on every reconcile without re-reading.
 */
export class SessionLineage extends Context.Service<
  SessionLineage,
  {
    readonly rootOf: (sessionId: string) => Effect.Effect<string>
    /** The current titles of these Sessions; one Session list read, empty when the controller cannot answer. */
    readonly titles: (sessionIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>
  }
>()('@dshfiles/thread-sidebar/SessionLineage') {
  static readonly rootOfWith = rootOf

  /** Lineage over a fixed header table, for tests that drive the provider without a Host. */
  static readonly layerTest = (headers: ReadonlyMap<string, LineageHeader>) =>
    Layer.succeed(
      SessionLineage,
      SessionLineage.of({
        rootOf: sessionId => rootOf({ sessionId, headerOf: id => Effect.succeed(headers.get(id)) }),
        titles: () => Effect.succeed(new Map()),
      }),
    )

  /** Lineage over fixed headers and titles, for tests that check the headline an item reads. */
  static readonly layerTestWithTitles = (headers: ReadonlyMap<string, LineageHeader>, titles: ReadonlyMap<string, string>) =>
    Layer.succeed(
      SessionLineage,
      SessionLineage.of({
        rootOf: sessionId => rootOf({ sessionId, headerOf: id => Effect.succeed(headers.get(id)) }),
        titles: sessionIds => Effect.succeed(new Map(sessionIds.flatMap(id => (titles.has(id) ? [[id, titles.get(id) ?? ''] as const] : [])))),
      }),
    )

  static readonly layer = Layer.effect(
    SessionLineage,
    Effect.gen(function* () {
      const host = yield* SidebarHost
      const cache = new Map<string, LineageHeader | undefined>()
      const remember = (sessionId: string, header: LineageHeader | undefined): void => {
        if (cache.size >= MAX_CACHED_HEADERS) {
          const oldest = cache.keys().next()
          if (oldest.done !== true) cache.delete(oldest.value)
        }
        cache.set(sessionId, header)
      }
      const headerOf = (sessionId: string): Effect.Effect<LineageHeader | undefined> => {
        if (cache.has(sessionId)) return Effect.succeed(cache.get(sessionId))
        return host.sessionHeader(sessionId).pipe(
          Effect.map(Option.getOrUndefined),
          // An unreadable header ends the walk here; it is not cached, so the next reconcile reads it again.
          Effect.orElseSucceed(() => undefined),
          // A missing header may appear once the Session is written; only a read header is final.
          Effect.tap(lineage => Effect.sync(() => (lineage === undefined ? undefined : remember(sessionId, lineage)))),
        )
      }
      // Titles change with renames, so they are read per reconcile rather than cached with the lineage.
      const titles = (sessionIds: readonly string[]): Effect.Effect<ReadonlyMap<string, string>> => {
        if (sessionIds.length === 0) return Effect.succeed(new Map())
        const wanted = new Set(sessionIds)
        return host.sessionTitles.pipe(
          Effect.map((all): ReadonlyMap<string, string> => new Map([...all].filter(([sessionId]) => wanted.has(sessionId)))),
          Effect.orElseSucceed((): ReadonlyMap<string, string> => new Map()),
        )
      }
      return SessionLineage.of({ rootOf: sessionId => rootOf({ sessionId, headerOf }), titles })
    }),
  )
}
