/**
 * The worker entry point. It owns the FTS5 index and every byte of decode, parse, and insert work, so the Host event
 * loop never performs index maintenance — not during a first full build and not during an ordinary search.
 *
 * Requests arrive as RPCs; the ingest loop is one fiber that yields between sessions, which is what keeps a search
 * answerable while the corpus is still being indexed.
 */
import { workerData } from 'node:worker_threads'

import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeWorkerRunner from '@effect/platform-node/NodeWorkerRunner'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Clock, Duration, Effect, FiberHandle, Layer, Queue, Ref, Schema } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { RpcServer } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

import { describeError, indexFailure } from './failure.js'
import { indexMigrations, SearchIndex } from './index-db.js'
import { IdleBackoff, indexSessions, runIngestPass } from './ingest.js'

const IDLE_SLEEP = IdleBackoff.first
import type { IndexHealth } from './api-schemas.js'
import { SearchWorkerFailed, SearchWorkerRpcs, workerConfigSchema } from './protocol.js'

const BUSY_SLEEP = Duration.millis(50)
const BACKFILL_ROWIDS = 2_000

const config = Schema.decodeUnknownSync(workerConfigSchema)(workerData)
const windowBytes = config.windowBytes ?? 2 * 1024 * 1024

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

const Handlers = SearchWorkerRpcs.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const index = new SearchIndex(sql, config.indexPath)
    // Searches read from their own connection, so a bounded ingest group can commit without queueing them behind its
    // transaction. The write connection keeps the only writer and the single-connection write path unchanged; in WAL mode
    // a reader sees the last committed snapshot, which is the same state a search between two groups used to see.
    const readSql = yield* SqliteClient.make({ filename: config.indexPath, readonly: true, busyTimeout: Duration.seconds(5) }).pipe(
      Effect.provide(Reactivity.layer),
    )
    const readIndex = new SearchIndex(readSql, config.indexPath)
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
    const loop = yield* FiberHandle.make<never, SqlError>()
    // The user's archived Sessions: cold history, dropped from the index and only read back for a targeted search.
    const archived = yield* Ref.make<ReadonlySet<string>>(new Set())
    // The index decides from its own stored stamp whether a compaction is due; this only spaces out the check.
    const COMPACTION_INTERVAL_MS = 60 * 60_000
    let lastCompactionCheckAt = 0

    const health = Effect.flatMap(Ref.get(progress), (current): Effect.Effect<IndexHealth, SearchWorkerFailed> =>
      readIndex
        .health({
          behindSessions: current.behindSessions,
          behindBytes: current.behindBytes,
          ingesting: current.ingesting,
          lastIngestMs: current.lastIngestMs,
          slowestIngestMs: current.slowestIngestMs,
          lastSearchMs: current.lastSearchMs,
          slowestSearchMs: current.slowestSearchMs,
          lastError: current.lastError,
        })
        .pipe(Effect.mapError(indexFailure)),
    )

    // True when a wake ended the pause, false when the time ran out.
    const pause = (duration: Duration.Duration) => Effect.raceFirst(Effect.as(Effect.sleep(duration), false), Effect.as(Queue.take(wake), true))
    let idlePasses = 0

    const pass = (root: string) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis
        const cold = yield* Ref.get(archived)
        yield* Ref.update(progress, current => ({ ...current, ingesting: true }))
        // One bounded step per loop, so searches still run between steps while an older index gains its conversation table.
        const outcome = yield* Effect.gen(function* () {
          const conversationReady = yield* index.backfillConversation(BACKFILL_ROWIDS)
          const rowMapReady = yield* index.backfillRowMap(BACKFILL_ROWIDS)
          const result = yield* runIngestPass({
            index,
            root,
            budgetMs: 1_000,
            windowBytes,
            now: Date.now,
            archived: cold,
            isArchived: sessionId => Effect.map(Ref.get(archived), current => current.has(sessionId)),
          })
          // Dropping archived Sessions empties most of the file; give the bytes back in a step of its own so a failure is
          // reported instead of swallowed by the pass.
          if (Date.now() - lastCompactionCheckAt > COMPACTION_INTERVAL_MS) {
            const checked = yield* index.compactIfDue(Date.now()).pipe(
              Effect.as(true),
              Effect.catch(error => Effect.succeed(describeError(error))),
            )
            if (checked === true) lastCompactionCheckAt = Date.now()
            else yield* Effect.logWarning('session-search: the index could not be compacted yet', checked)
          }
          return { backfilled: conversationReady && rowMapReady, result }
        }).pipe(
          // The loop must survive whatever one pass hits: a corrupt log or a sync read error is a failed attempt that is
          // reported and retried, not the end of ingest for the life of the worker.
          Effect.catchDefect(defect => Effect.fail(indexFailure(defect))),
          Effect.result,
        )
        const elapsed = (yield* Clock.currentTimeMillis) - startedAt
        if (outcome._tag === 'Failure') {
          yield* Ref.update(progress, current => ({ ...current, ingesting: false, lastIngestMs: elapsed, lastError: describeError(outcome.failure) }))
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
      }).pipe(Effect.ensuring(Ref.update(progress, current => (current.ingesting ? { ...current, ingesting: false } : current))))

    const ingestLoop = Effect.forever(
      Effect.gen(function* () {
        const root = (yield* Ref.get(progress)).root
        if (root === undefined) return yield* Effect.asVoid(Queue.take(wake))
        const next = yield* pass(root)
        idlePasses = next === IDLE_SLEEP ? idlePasses + 1 : 0
        if (yield* pause(next === IDLE_SLEEP ? IdleBackoff.after(idlePasses) : next)) idlePasses = 0
      }),
    )

    const timedSearch = <A>(search: Effect.Effect<A, unknown>) =>
      Effect.gen(function* () {
        const startedAt = performance.now()
        const result = yield* search.pipe(Effect.mapError(indexFailure))
        const elapsed = Math.round(performance.now() - startedAt)
        yield* Ref.update(progress, current => ({ ...current, lastSearchMs: elapsed, slowestSearchMs: Math.max(current.slowestSearchMs, elapsed) }))
        return result
      })

    return {
      SearchSessions: request =>
        Effect.gen(function* () {
          // A targeted search names the Sessions it wants, so cold ones are read back for this request only.
          if (request.sessionIds !== undefined && request.sessionIds.length > 0) {
            const root = (yield* Ref.get(progress)).root
            if (root !== undefined) {
              yield* indexSessions({ index, root, budgetMs: 1_000, windowBytes, now: Date.now }, request.sessionIds ?? []).pipe(Effect.mapError(indexFailure))
            }
          }
          return yield* timedSearch(readIndex.searchSessions(request))
        }),
      SearchEvents: request => timedSearch(Effect.map(readIndex.searchEvents(request), rows => ({ sessionId: request.sessionId, ...rows }))),
      // A find names its Session, so an archived (cold) one is read back for this request, as a targeted search is.
      FindInSession: request =>
        Effect.gen(function* () {
          const root = (yield* Ref.get(progress)).root
          if (root !== undefined) {
            yield* indexSessions({ index, root, budgetMs: 1_000, windowBytes, now: Date.now }, [request.sessionId]).pipe(Effect.mapError(indexFailure))
          }
          return yield* timedSearch(readIndex.findInSession(request))
        }),
      PromptHistory: request => timedSearch(index.promptHistory(request)),
      Health: () => health,
      Nudge: () => Effect.andThen(Queue.offer(wake, undefined), health),
      SetArchived: request =>
        Effect.gen(function* () {
          yield* Ref.set(archived, new Set(request.archivedSessionIds))
          yield* Queue.offer(wake, undefined)
          return yield* health
        }),
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

const indexLayer = SqliteStore.layer({ filename: config.indexPath, migrations: indexMigrations }).pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const WorkerServer = RpcServer.layer(SearchWorkerRpcs).pipe(
  Layer.provide(Handlers),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.provide(indexLayer),
)

NodeRuntime.runMain(Layer.launch(WorkerServer))
