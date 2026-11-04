/**
 * The worker entry point. It owns the FTS5 index and every byte of decode, parse, and insert work, so the Host event
 * loop never performs index maintenance — not during a first full build and not during an ordinary search.
 *
 * Requests arrive as RPCs; the ingest loop is one fiber that yields between sessions, which is what keeps a search
 * answerable while the corpus is still being indexed.
 */
import { workerData } from 'node:worker_threads'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeWorkerRunner from '@effect/platform-node/NodeWorkerRunner'
import { Clock, Duration, Effect, FiberHandle, Layer, Queue, Ref, Schema } from 'effect'
import { RpcServer } from 'effect/rpc'

import { SearchIndex } from './index-db.js'
import { runIngestPass } from './ingest.js'
import { SearchWorkerFailed, SearchWorkerRpcs, workerConfigSchema, type IndexHealth } from './protocol.js'

const IDLE_SLEEP = Duration.seconds(5)
const BUSY_SLEEP = Duration.millis(50)
const BACKFILL_ROWIDS = 2_000

type Progress = {
  readonly root: string | undefined
  readonly ingesting: boolean
  readonly lastIngestMs: number
  readonly slowestIngestMs: number
  readonly lastSearchMs: number
  readonly slowestSearchMs: number
  readonly lastError: string | null
  readonly behindSessions: number
  readonly behindBytes: number
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

const indexFailure = (cause: unknown) => new SearchWorkerFailed({ code: 'session-search-index-failed', reason: describeError(cause), cause })

const Handlers = SearchWorkerRpcs.toLayer(
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknownEffect(workerConfigSchema)(workerData)
    const windowBytes = config.windowBytes ?? 2 * 1024 * 1024
    const index = yield* Effect.acquireRelease(
      Effect.sync(() => new SearchIndex(config.indexPath)),
      opened => Effect.sync(() => opened.close()),
    )
    const progress = yield* Ref.make<Progress>({
      root: undefined,
      ingesting: false,
      lastIngestMs: 0,
      slowestIngestMs: 0,
      lastSearchMs: 0,
      slowestSearchMs: 0,
      lastError: null,
      behindSessions: 0,
      behindBytes: 0,
    })
    // A committed session event cuts the loop's sleep short, so fresh content is searchable without waiting out the idle delay.
    const wake = yield* Queue.dropping<void>(1)
    const loop = yield* FiberHandle.make<never, never>()

    const health = Effect.flatMap(Ref.get(progress), (current): Effect.Effect<IndexHealth, SearchWorkerFailed> =>
      Effect.try({
        try: () =>
          index.health({
            behindSessions: current.behindSessions,
            behindBytes: current.behindBytes,
            ingesting: current.ingesting,
            lastIngestMs: current.lastIngestMs,
            slowestIngestMs: current.slowestIngestMs,
            lastSearchMs: current.lastSearchMs,
            slowestSearchMs: current.slowestSearchMs,
            lastError: current.lastError,
          }),
        catch: indexFailure,
      }),
    )

    const pause = (duration: Duration.Duration) => Effect.raceFirst(Effect.sleep(duration), Effect.asVoid(Queue.take(wake)))

    const pass = (root: string) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis
        yield* Ref.update(progress, current => ({ ...current, ingesting: true }))
        const outcome = yield* Effect.tryPromise(async () => {
          // One bounded step per loop, so searches still run between steps while an older index gains its conversation table.
          const backfilled = index.backfillConversation(BACKFILL_ROWIDS) && index.backfillRowMap(BACKFILL_ROWIDS)
          const result = await runIngestPass({ index, root, budgetMs: 1_000, windowBytes, now: Date.now })
          return { backfilled, result }
        }).pipe(Effect.result)
        const elapsed = (yield* Clock.currentTimeMillis) - startedAt
        if (outcome._tag === 'Failure') {
          yield* Ref.update(progress, current => ({ ...current, ingesting: false, lastIngestMs: elapsed, lastError: describeError(outcome.failure.cause) }))
          return IDLE_SLEEP
        }
        const result = outcome.success.result
        yield* Ref.update(progress, current => ({
          ...current,
          ingesting: false,
          behindSessions: result.behindSessions,
          behindBytes: result.behindBytes,
          lastError: null,
          lastIngestMs: elapsed,
          slowestIngestMs: Math.max(current.slowestIngestMs, elapsed),
        }))
        return outcome.success.backfilled && result.complete && result.ingested === 0 ? IDLE_SLEEP : BUSY_SLEEP
      })

    const ingestLoop = Effect.forever(
      Effect.gen(function* () {
        const root = (yield* Ref.get(progress)).root
        if (root === undefined) return yield* Effect.asVoid(Queue.take(wake))
        yield* pause(yield* pass(root))
      }),
    )

    const timedSearch = <A>(search: () => A) =>
      Effect.gen(function* () {
        const startedAt = performance.now()
        const result = yield* Effect.try({ try: search, catch: indexFailure })
        const elapsed = Math.round(performance.now() - startedAt)
        yield* Ref.update(progress, current => ({ ...current, lastSearchMs: elapsed, slowestSearchMs: Math.max(current.slowestSearchMs, elapsed) }))
        return result
      })

    return {
      SearchSessions: request => timedSearch(() => index.searchSessions(request)),
      SearchEvents: request => timedSearch(() => ({ sessionId: request.sessionId, ...index.searchEvents(request) })),
      Health: () => health,
      Nudge: () => Effect.andThen(Queue.offer(wake, undefined), health),
      StartIngest: request =>
        Effect.gen(function* () {
          yield* Ref.update(progress, current => ({ ...current, root: request.root }))
          yield* FiberHandle.run(loop, ingestLoop, { onlyIfMissing: true })
          yield* Queue.offer(wake, undefined)
          return yield* health
        }),
    }
  }),
)

const WorkerServer = RpcServer.layer(SearchWorkerRpcs).pipe(
  Layer.provide(Handlers),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
)

NodeRuntime.runMain(Layer.launch(WorkerServer))
