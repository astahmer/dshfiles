import { Clock, Context, Effect, FiberHandle, Layer, Ref } from 'effect'
import { HostDirectory } from './host-edge-promise.js'
import type { KnownSession } from './process-table.js'

const SUCCESS_TTL_MS = 30_000
const FAILURE_TTL_MS = 45_000

interface CachedSessions {
  readonly value: readonly KnownSession[]
  readonly refreshAt: number
}

/**
 * The Host's Sessions, served stale while one refresh runs in the background, so a memory probe never waits on the
 * Session list. A failed refresh keeps the last good value and backs off longer than a successful one.
 */
export class SessionMetadata extends Context.Service<
  SessionMetadata,
  {
    readonly current: Effect.Effect<readonly KnownSession[]>
    /** Refresh now unless a refresh is running or not yet due, and wait for it. */
    readonly refresh: Effect.Effect<void>
  }
>()('@dshfiles/worktree-memory/SessionMetadata') {
  static readonly layer = Layer.effect(
    SessionMetadata,
    Effect.gen(function* () {
      const directory = yield* HostDirectory
      const cached = yield* Ref.make<CachedSessions>({ value: [], refreshAt: 0 })
      const running = yield* FiberHandle.make<void, never>()

      const load = Effect.gen(function* () {
        const sessions = yield* directory.sessions
        const now = yield* Clock.currentTimeMillis
        yield* Ref.update(cached, current =>
          sessions === undefined ? { ...current, refreshAt: now + FAILURE_TTL_MS } : { value: sessions, refreshAt: now + SUCCESS_TTL_MS },
        )
      }).pipe(Effect.withSpan('worktree-memory list sessions'))

      const start = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (now < (yield* Ref.get(cached)).refreshAt) return
        yield* FiberHandle.run(running, load, { onlyIfMissing: true })
      })

      const refresh = Effect.andThen(start, FiberHandle.awaitEmpty(running))

      return SessionMetadata.of({
        current: Effect.andThen(
          start,
          Effect.map(Ref.get(cached), current => current.value),
        ),
        refresh,
      })
    }),
  )
}
