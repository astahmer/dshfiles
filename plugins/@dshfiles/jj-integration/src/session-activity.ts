import { Clock, Context, Duration, Effect, Fiber, FiberMap, Layer, Option, Ref } from 'effect'
import { SessionReads, type SessionActivityMap } from './host-edges-promise.js'
import { ThreadRebaseEligibilityModel, type ThreadSessionActivity } from './thread-rebase-eligibility.js'

/** A full Session activity fold is kept for display and repository-wide cleanup, but never gates one thread rebase. */
const DISPLAY_TTL = Duration.seconds(30)
const DISPLAY_BUDGET = Duration.millis(2_500)
/** How long one guard attempt waits on the authoritative read before it waits again. */
const GUARD_BUDGET = Duration.seconds(15)
/** Bounded waits one guard accepts; every attempt keeps waiting on the same read. */
const GUARD_ATTEMPTS = 3
/** Hard ceiling for one authoritative read, so a stuck read cannot answer every later guard with unknown. */
const GUARD_CEILING = Duration.seconds(60)
const WORKSPACE_ACTIVITY_READ_CONCURRENCY = 4

type ReadOutcome = 'unavailable' | 'absent' | ThreadSessionActivity

const unknownActivity: ThreadSessionActivity = { running: undefined, pendingUserQuestion: undefined }

/**
 * Display and repository-wide cleanup share a bounded full-store read and keep serving the last good value. A rebase
 * guard instead reads only the workspace's Sessions, so one thread's eligibility never waits for unrelated Sessions;
 * both guard paths keep waiting on one authoritative read across budgets instead of restarting completed work.
 */
export class SessionActivity extends Context.Service<
  SessionActivity,
  {
    /** A value within its TTL, otherwise the last good value while one bounded read refreshes it. */
    readonly display: Effect.Effect<SessionActivityMap | undefined>
    /** Activity read the moment a guard decides: every Session when `sessionIds` is omitted, else only those. */
    readonly guard: (sessionIds?: readonly string[]) => Effect.Effect<SessionActivityMap | undefined>
    /**
     * One workspace as it is now, for a status that says whether it can land: the display value may predate the end of
     * a turn by its whole TTL. A read over the display budget answers with the display value rather than hold a poll.
     */
    readonly workspaceDisplay: (sessionIds: readonly string[]) => Effect.Effect<SessionActivityMap | undefined>
    readonly reset: Effect.Effect<void>
  }
>()('@dshfiles/jj-integration/SessionActivity') {
  static readonly layer = Layer.effect(
    SessionActivity,
    Effect.gen(function* () {
      const sessions = yield* SessionReads
      const cached = yield* Ref.make(Option.none<{ readonly value: SessionActivityMap; readonly at: number }>())
      const scans = yield* FiberMap.make<string, SessionActivityMap | undefined, never>()
      const startedAt = yield* Ref.make<ReadonlyMap<string, number>>(new Map())

      const publish = (value: SessionActivityMap | undefined) =>
        value === undefined ? Effect.void : Effect.flatMap(Clock.currentTimeMillis, at => Ref.set(cached, Option.some({ value, at })))

      const fullRead = sessions.listActivity().pipe(Effect.option, Effect.map(Option.getOrUndefined))

      const readOne = (sessionId: string): Effect.Effect<readonly [string, ReadOutcome]> =>
        sessions.projections(sessionId).pipe(
          Effect.flatMap(projections =>
            projections === null
              ? Effect.succeed<readonly [string, ReadOutcome]>([sessionId, 'absent'])
              : Effect.map(sessions.isRunning(sessionId), (running): readonly [string, ReadOutcome] => [
                  sessionId,
                  {
                    running,
                    pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(
                      projections.values.userQuestions == null ? undefined : { userQuestions: projections.values.userQuestions },
                    ),
                    title: projections.values.title ?? undefined,
                    blank: projections.values.sessionListMetadata?.blank,
                  },
                ]),
          ),
          Effect.orElseSucceed((): readonly [string, ReadOutcome] => [sessionId, 'unavailable']),
        )

      /** Unreadable or absent Sessions fall back to the full list; one that list does not know either cannot be busy. */
      const workspaceRead = Effect.fn('session activity guard read')(function* (sessionIds: readonly string[]) {
        const outcomes = yield* Effect.forEach([...new Set(sessionIds)], readOne, { concurrency: WORKSPACE_ACTIVITY_READ_CONCURRENCY })
        const activity = new Map<string, ThreadSessionActivity>()
        const unresolved: string[] = []
        const absent = new Set<string>()
        for (const [sessionId, outcome] of outcomes) {
          if (outcome === 'unavailable' || outcome === 'absent') {
            unresolved.push(sessionId)
            if (outcome === 'absent') absent.add(sessionId)
            activity.set(sessionId, unknownActivity)
            continue
          }
          activity.set(sessionId, outcome)
        }
        if (unresolved.length === 0) return activity
        const fallback = yield* sessions.listActivity(unresolved).pipe(Effect.option)
        if (Option.isNone(fallback)) return activity
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- only absent Sessions read their running flag, a synchronous registry lookup.
        for (const sessionId of unresolved) {
          const known = fallback.value.get(sessionId)
          if (known !== undefined) {
            activity.set(sessionId, known)
            continue
          }
          if (absent.has(sessionId)) activity.set(sessionId, { running: yield* sessions.isRunning(sessionId), pendingUserQuestion: false })
        }
        return activity
      })

      const shared = Effect.fnUntraced(function* (key: string, read: Effect.Effect<SessionActivityMap | undefined>) {
        const running = yield* FiberMap.get(scans, key)
        if (Option.isSome(running)) return running.value
        const now = yield* Clock.currentTimeMillis
        yield* Ref.update(startedAt, current => new Map([...current, [key, now]]))
        return yield* FiberMap.run(scans, key, read)
      })

      const refresh = shared(
        'display',
        fullRead.pipe(
          Effect.timeoutOption(DISPLAY_BUDGET),
          Effect.map(Option.flatMap(Option.fromNullishOr)),
          Effect.map(Option.getOrUndefined),
          Effect.tap(publish),
        ),
      )

      const display = Effect.gen(function* () {
        const current = yield* Ref.get(cached)
        if (Option.isNone(current)) return yield* Fiber.join(yield* refresh)
        if ((yield* Clock.currentTimeMillis) - current.value.at < Duration.toMillis(DISPLAY_TTL)) return current.value.value
        yield* refresh
        return current.value.value
      }).pipe(Effect.withSpan('session activity display'))

      const guard = Effect.fn('session activity guard')(function* (sessionIds?: readonly string[]) {
        const key = sessionIds === undefined ? 'guard' : `guard:${JSON.stringify([...new Set(sessionIds)].sort())}`
        const read = (sessionIds === undefined ? fullRead.pipe(Effect.tap(publish)) : workspaceRead(sessionIds)).pipe(
          Effect.timeoutOption(GUARD_CEILING),
          Effect.map(Option.getOrUndefined),
        )
        let unfinished: Fiber.Fiber<SessionActivityMap | undefined> | undefined
        for (let attempt = 1; attempt <= GUARD_ATTEMPTS; attempt += 1) {
          const scan = yield* shared(key, read)
          const settled = yield* Fiber.join(scan).pipe(Effect.timeoutOption(GUARD_BUDGET))
          // A read that already failed does not get faster on the next wait; a fresh one may still answer.
          if (Option.isNone(settled)) {
            unfinished = scan
            continue
          }
          unfinished = undefined
          if (settled.value !== undefined) return settled.value
        }
        if (unfinished === undefined) return undefined
        // Slow is not unreadable: the last read keeps what is left of its own ceiling instead of answering unknown.
        const now = yield* Clock.currentTimeMillis
        const began = (yield* Ref.get(startedAt)).get(key) ?? now
        const remaining = Math.max(0, Duration.toMillis(GUARD_CEILING) - (now - began))
        return Option.getOrUndefined(Option.flatMap(yield* Fiber.join(unfinished).pipe(Effect.timeoutOption(Duration.millis(remaining))), Option.fromNullishOr))
      })

      const workspaceDisplay = Effect.fn('session activity workspace display')(function* (sessionIds: readonly string[]) {
        const fresh = yield* guard(sessionIds).pipe(Effect.timeoutOption(DISPLAY_BUDGET))
        return Option.isSome(fresh) && fresh.value !== undefined ? fresh.value : yield* display
      })

      return SessionActivity.of({ display, guard, workspaceDisplay, reset: Ref.set(cached, Option.none()) })
    }),
  )
}
