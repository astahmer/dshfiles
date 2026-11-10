/**
 * Host half of the worker protocol: an `RpcClient` over one Node worker thread. The pool respawns the worker after a
 * crash; every call here is asynchronous and cheap, so no decode, parse or SQLite work happens on the Host's thread.
 */
import { Worker } from 'node:worker_threads'

import * as NodeWorker from '@effect/platform-node/NodeWorker'
import { Context, Duration, Effect, FileSystem, Layer, Path } from 'effect'
import { RpcClient, type RpcClientError } from 'effect/rpc'

import {
  SearchWorkerFailed,
  SearchWorkerRpcs,
  type IndexHealth,
  type SearchEventsResult,
  type SearchSessionsResult,
  type SessionEventSearchRequest,
  type SessionSearchRequest,
} from './protocol.js'

export interface SearchWorkerOptions {
  readonly indexPath: string
  readonly windowBytes?: number | undefined
  readonly requestTimeout?: Duration.Input | undefined
  /** The worker entry; defaults to the built `search-worker.js` next to this module or the package's `dist/`. */
  readonly workerUrl?: URL | undefined
}

type WorkerCall<A> = Effect.Effect<A, SearchWorkerFailed>

/**
 * A built plugin loads its sibling `dist/search-worker.js`; a source run (tests, `dshx dev`) falls back to the worker
 * built next to the package. Node cannot resolve `.js` specifiers inside a `.ts` module, so the built file is the
 * supported path — build the plugin before testing.
 */
const noArgs: readonly string[] = []
const stripTypes: readonly string[] = ['--experimental-strip-types']

const workerEntry = Effect.fn('session search worker entry')(function* (base: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const candidate of [new URL('./search-worker.js', base), new URL('../dist/search-worker.js', base)]) {
    if (yield* fs.exists(yield* path.fromFileUrl(candidate))) return { url: candidate, execArgv: noArgs }
  }
  return { url: new URL('./search-worker.ts', base), execArgv: stripTypes }
})

const transportFailure = (error: RpcClientError.RpcClientError) =>
  new SearchWorkerFailed({ code: 'session-search-worker-failed', reason: `The session-search worker failed: ${error.message}`, cause: error })

export class SearchWorker extends Context.Service<
  SearchWorker,
  {
    readonly searchSessions: (request: SessionSearchRequest) => WorkerCall<SearchSessionsResult>
    readonly searchEvents: (request: SessionEventSearchRequest) => WorkerCall<SearchEventsResult>
    readonly health: WorkerCall<IndexHealth>
    /** Wake the ingest loop now, for example after a Session event was committed. */
    readonly nudge: WorkerCall<IndexHealth>
    readonly startIngest: (root: string) => WorkerCall<IndexHealth>
    /** Replace the archived set: those Sessions are cold, so the ingest pass drops their documents. */
    readonly setArchived: (archivedSessionIds: readonly string[]) => WorkerCall<IndexHealth>
  }
>()('@dshfiles/session-search/SearchWorker') {
  /** The worker spawns on the first call and terminates when the layer's scope closes. */
  static readonly layer = (options: SearchWorkerOptions) =>
    Layer.effect(
      SearchWorker,
      Effect.gen(function* () {
        const client = yield* RpcClient.make(SearchWorkerRpcs)
        const timeout = options.requestTimeout ?? '30 seconds'
        const call = <A>(effect: Effect.Effect<A, SearchWorkerFailed | RpcClientError.RpcClientError>): WorkerCall<A> =>
          effect.pipe(
            Effect.catchTag('RpcClientError', error => Effect.fail(transportFailure(error))),
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.fail(
                  new SearchWorkerFailed({
                    code: 'session-search-worker-timeout',
                    reason: `The session-search worker did not answer within ${Duration.toMillis(timeout)} ms.`,
                  }),
                ),
            }),
          )
        return SearchWorker.of({
          searchSessions: request => call(client.SearchSessions(request)),
          searchEvents: request => call(client.SearchEvents(request)),
          health: call(client.Health()),
          nudge: call(client.Nudge()),
          startIngest: root => call(client.StartIngest({ root })),
          setArchived: archivedSessionIds => call(client.SetArchived({ archivedSessionIds: [...archivedSessionIds] })),
        })
      }),
    ).pipe(
      Layer.provide(RpcClient.layerProtocolWorker({ size: 1, concurrency: 64 })),
      Layer.provide(
        Layer.unwrap(
          Effect.gen(function* () {
            const entry = options.workerUrl === undefined ? yield* workerEntry(import.meta.url) : { url: options.workerUrl, execArgv: noArgs }
            const workerData = { indexPath: options.indexPath, ...(options.windowBytes !== undefined && { windowBytes: options.windowBytes }) }
            // The worker decodes bounded 2 MB windows into documents; 512 MB is far above that peak and keeps a runaway
            // index pass from growing its own isolate to the Host's 4 GB limit.
            return NodeWorker.layer(
              () =>
                new Worker(entry.url, {
                  workerData,
                  resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
                  ...(entry.execArgv.length > 0 && { execArgv: [...entry.execArgv] }),
                }),
            )
          }),
        ),
      ),
    )
}
