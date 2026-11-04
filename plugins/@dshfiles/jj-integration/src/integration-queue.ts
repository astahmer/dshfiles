import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Context, Duration, Effect, Layer, Path, Stream } from 'effect'
import { LandAttention } from './attention-provider.js'
import { ActivityLog, WorkspaceRegistry } from './host-edges-promise.js'
import { IntegrationRequests, IsolatedSessions, type QueuedIntegration } from './integration-requests.js'
import { Landing } from './landing.js'
import { RepositoryViews } from './repository-views.js'

/** Session events arrive in bursts while a turn streams; a queued integration retries once its thread went quiet. */
const SETTLE_DELAY = Duration.millis(1_500)
/** Catches idleness no Session event announced, e.g. a question dismissed from another client. */
const FALLBACK_INTERVAL = Duration.seconds(30)

/**
 * When the retry worker tries the queued integrations: at once when one is queued, `SETTLE_DELAY` after the last of a
 * burst of relevant Session events, and every `FALLBACK_INTERVAL` regardless.
 */
const wakeups = <R>(input: {
  readonly queued: Stream.Stream<void>
  readonly sessionEvents: Stream.Stream<unknown, never, R>
}): Stream.Stream<unknown, never, R> =>
  Stream.mergeAll([input.queued, input.sessionEvents.pipe(Stream.debounce(SETTLE_DELAY)), Stream.tick(FALLBACK_INTERVAL).pipe(Stream.drop(1))], {
    concurrency: 'unbounded',
  })

export class IntegrationWakeups {
  static readonly merge = wakeups
  static readonly settleDelay = SETTLE_DELAY
  static readonly fallbackInterval = FALLBACK_INTERVAL
}

const isWaiting = (error: { readonly _tag: string }): boolean => error._tag === 'ThreadActive' || error._tag === 'ThreadActivityUnknown'

/** Retries queued integrations until each one lands, fails for another reason than a busy thread, or is cancelled. */
export class IntegrationQueue extends Context.Service<IntegrationQueue, { readonly drain: Effect.Effect<void> }>()(
  '@dshfiles/jj-integration/IntegrationQueue',
) {
  static readonly layer = Layer.effect(
    IntegrationQueue,
    Effect.gen(function* () {
      const landing = yield* Landing
      const requests = yield* IntegrationRequests
      const isolated = yield* IsolatedSessions
      const registry = yield* WorkspaceRegistry
      const views = yield* RepositoryViews
      const log = yield* ActivityLog
      const attention = yield* LandAttention
      const path = yield* Path.Path

      const settled = Effect.fnUntraced(function* (entry: QueuedIntegration, error?: { readonly message: string }) {
        yield* views.invalidate
        if (error === undefined) return yield* attention.queuedLandSucceeded(entry.path)
        yield* attention.queuedLandFailed(entry.path, error.message)
        yield* log.emit({
          type: 'workspace.queued_integration_failed',
          level: 'attention',
          summary: `Queued integration of ${path.basename(entry.path)} stopped before rebasing`,
          detail: error.message,
          path: entry.path,
          sessionId: entry.sessionId,
        })
      })

      const attempt = Effect.fn('integration queue attempt')(
        function* (entry: QueuedIntegration) {
          const outcome = yield* landing
            .land({ path: entry.path, sessionId: entry.sessionId, fromAgent: false, stillQueued: requests.passGuard(entry) })
            .pipe(Effect.result)
          if (!(yield* requests.isCurrent(entry))) return
          if (outcome._tag === 'Success') {
            yield* requests.settle(entry)
            return yield* settled(entry)
          }
          if (!(yield* requests.hasPassedGuard(entry.path)) && isWaiting(outcome.failure)) return
          yield* requests.settle(entry)
          yield* settled(entry, outcome.failure)
        },
        (effect, entry) => Effect.ensuring(effect, requests.endAttempt(entry.path)),
      )

      const drain = Effect.gen(function* () {
        for (const entry of yield* requests.entries) yield* attempt(entry)
      }).pipe(Effect.catchCause(cause => Effect.logWarning('jj-integration: queued integration failed', cause)))

      const touchesQueuedThread = Effect.fnUntraced(function* (sessionId: string) {
        const queued = (yield* requests.entries).map(entry => entry.path)
        if (queued.length === 0) return false
        const workspaces = yield* registry.list.pipe(Effect.orElseSucceed(() => []))
        if (workspaces.some(workspace => queued.includes(workspace.path) && workspace.sessionIds.some(id => String(id) === sessionId))) return true
        const isolatedPaths = yield* Effect.forEach(queued, queuedPath => isolated.sessionIdsAt(queuedPath))
        return isolatedPaths.some(sessionIds => sessionIds.includes(sessionId))
      })

      const sessionEvents = HostEvents.stream('session/event').pipe(Stream.filterEffect(([session]) => touchesQueuedThread(String(session.id))))

      yield* DshxPlugin.worker(Stream.runForEach(wakeups({ queued: requests.queued, sessionEvents }), () => drain))

      return IntegrationQueue.of({ drain })
    }),
  )
}
