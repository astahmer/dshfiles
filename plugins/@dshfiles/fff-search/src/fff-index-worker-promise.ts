import { Worker } from 'node:worker_threads'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Deferred, Duration, Effect, Layer, MutableRef, Option, Ref, Schema } from 'effect'
import { FffSearch, FffSearchError } from './fff-search.js'

/** Matches the stock grep's cooperative timeout; a request still pending then is failed, not left hanging. */
const REQUEST_TIMEOUT = Duration.seconds(30)

type WorkerRequest = typeof FffSearch.workerRequest.Encoded
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
export type FffRequest = DistributiveOmit<WorkerRequest, 'id'>

const decodeReply = Schema.decodeUnknownOption(FffSearch.workerReply)

/** The worker script the Host spawns; built beside the Host bundle as `dist/fff-worker.js`. */
export const FffWorkerEntry = Context.Reference<URL>('@dshfiles/fff-search/FffWorkerEntry', {
  defaultValue: () => new URL('./fff-worker.js', import.meta.url),
})

/**
 * The index worker thread: fff queries are synchronous FFI calls, so every index lives in the worker and the Host only
 * posts messages. A crashed worker takes its indexes with it; the next request spawns a fresh one.
 */
export class FffIndexWorker extends Context.Service<FffIndexWorker, { readonly ask: (request: FffRequest) => Effect.Effect<unknown, FffSearchError> }>()(
  '@dshfiles/fff-search/FffIndexWorker',
) {
  static readonly layer = Layer.effect(
    FffIndexWorker,
    Effect.gen(function* () {
      const host = yield* HostContext
      const entry = yield* FffWorkerEntry
      const logger = host.ctx.logger('fff-search')
      // The worker callbacks read and write these synchronously.
      const current = MutableRef.make(Option.none<Worker>())
      const pending = MutableRef.make(new Map<number, Deferred.Deferred<unknown, FffSearchError>>())
      const nextId = yield* Ref.make(1)

      const failPending = (reason: string) => {
        for (const deferred of MutableRef.get(pending).values()) Deferred.doneUnsafe(deferred, Effect.fail(new FffSearchError({ reason })))
        MutableRef.set(pending, new Map())
      }

      const spawn = () => {
        // The index itself is the native finder; the worker's own JS only shuttles queries, so a small isolate is enough
        // and a runaway cannot grow to the Host's default limit.
        const spawned = new Worker(entry, {
          workerData: { stateRoot: dshHomePath('plugins', 'fff-search') },
          resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
        })
        // oxlint-disable-next-line antislop/no-unknown-parameters -- The worker message boundary; `workerReply` decoding runs on the next line.
        spawned.on('message', (raw: unknown) => {
          const reply = decodeReply(raw)
          if (Option.isNone(reply)) return
          const deferred = MutableRef.get(pending).get(reply.value.id)
          if (deferred === undefined) return
          Deferred.doneUnsafe(deferred, reply.value.ok ? Effect.succeed(reply.value.value) : Effect.fail(new FffSearchError({ reason: reply.value.error })))
        })
        spawned.on('error', error => logger.warn(`fff-search: worker failed: ${error.message}`))
        spawned.on('exit', code => {
          if (Option.contains(MutableRef.get(current), spawned)) MutableRef.set(current, Option.none())
          failPending(`fff-search worker exited with code ${String(code)}`)
        })
        spawned.unref()
        MutableRef.set(current, Option.some(spawned))
        return spawned
      }

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const worker = MutableRef.getAndSet(current, Option.none())
          failPending('fff-search is unloading')
          if (Option.isSome(worker)) yield* Effect.promise(() => worker.value.terminate())
        }),
      )

      const ask = Effect.fn('fff-search ask')(function* (request: FffRequest) {
        yield* Effect.annotateCurrentSpan({ 'fff_search.request': request.kind })
        const id = yield* Ref.getAndUpdate(nextId, value => value + 1)
        const deferred = yield* Deferred.make<unknown, FffSearchError>()
        MutableRef.update(pending, map => new Map(map).set(id, deferred))
        const worker = yield* Effect.try({
          try: () => Option.getOrElse(MutableRef.get(current), spawn),
          catch: cause => new FffSearchError({ reason: 'fff-search could not start its index worker; reload the plugin and retry.', cause }),
        })
        worker.postMessage({ ...request, id })
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: REQUEST_TIMEOUT,
            orElse: () =>
              Effect.fail(new FffSearchError({ reason: `fff-search ${request.kind} did not answer within ${Duration.toSeconds(REQUEST_TIMEOUT)} s` })),
          }),
          Effect.ensuring(
            Effect.sync(() =>
              MutableRef.update(pending, map => {
                const next = new Map(map)
                next.delete(id)
                return next
              }),
            ),
          ),
        )
      })

      return FffIndexWorker.of({ ask })
    }),
  )
}
