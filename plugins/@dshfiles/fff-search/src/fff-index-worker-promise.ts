import { fileURLToPath } from 'node:url'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { hostService } from '@dshfiles/dshx/effect'
import * as NodeSocket from '@effect/platform-node/NodeSocket'
import { Context, Duration, Effect, Layer, RcRef, Schedule, Schema } from 'effect'
import { Socket } from 'effect/socket'
import { RpcClient, RpcSerialization, type RpcClientError } from 'effect/rpc'
import { fffIndexConfig, FffIndexRpcs, type GlobRequest, type GrepRequest } from './fff-index-protocol.js'
import { FffSearch, FffSearchError } from './fff-search.js'

/** Matches the stock grep's cooperative timeout; a request still pending then is failed, not left hanging. */
const REQUEST_TIMEOUT = Duration.seconds(30)
/** How long a closing index process gets to exit on its own before DSH terminates its range. */
const EXIT_GRACE = Duration.seconds(5)
/** DSH's own TERM-to-KILL grace once it terminates the range. */
const TERMINATE_GRACE_MS = 2_000
/**
 * fff queries are synchronous in the index process, so a long one delays its pong: probe rarely. A crash closes the
 * control pipe, which fails pending calls at once without waiting for a ping.
 */
const PING_INTERVAL = Duration.minutes(1)

/** The index process entry; built beside the Host bundle as `dist/fff-worker.js`. */
export const FffWorkerEntry = Context.Reference<URL>('@dshfiles/fff-search/FffWorkerEntry', {
  defaultValue: () => new URL('./fff-worker.js', import.meta.url),
})

type Call<A> = Effect.Effect<A, FffSearchError>

const spawnFailure = (cause: unknown) => new FffSearchError({ reason: 'fff-search could not start its index process; reload the plugin and retry.', cause })

const transportFailure = (error: RpcClientError.RpcClientError) =>
  new FffSearchError({ reason: `fff-search's index process failed: ${error.message}. The next search starts a new one.`, cause: error })

/** The spawn request: Node on the index entry, with the RPC on the inherited control pipe and stdio left to the Host. */
const indexSpec = Effect.gen(function* () {
  const entry = fileURLToPath(yield* FffWorkerEntry)
  // Read at each start: the DSH home is an environment fact, not a constant of this module.
  const config = Schema.encodeSync(fffIndexConfig)({ stateRoot: dshHomePath('plugins', 'fff-search') })
  return {
    // The process only shuttles queries to the native index; a small heap keeps a runaway from growing large.
    argv: [process.execPath, '--max-old-space-size=256', entry, config],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', control: 'pipe' },
    graceMs: TERMINATE_GRACE_MS,
  } satisfies SubprocessSpawnSpec
})

/**
 * Close the control pipe, which asks the process to exit; terminate its range when it is still there after the grace.
 * The RPC socket has already let go of the pipe, so destroying it leaves no listener-less error behind.
 */
const stopIndex = (handle: SubprocessHandle) =>
  Effect.sync(() => handle.control?.destroy()).pipe(
    Effect.andThen(Effect.tryPromise(signal => handle.waitForExit(signal))),
    Effect.timeout(EXIT_GRACE),
    Effect.catch(() =>
      Effect.tryPromise(signal => {
        handle.terminate()
        return handle.waitForExit(signal)
      }),
    ),
    Effect.ignore({ log: 'Warn', message: 'fff-search: the index process did not stop cleanly' }),
  )

/** One index process and the RPC client on its control pipe; closing the scope stops both. */
const startIndex = Effect.gen(function* () {
  const subprocess = yield* hostService('subprocess').pipe(Effect.mapError(spawnFailure))
  const spec = yield* indexSpec
  const handle = yield* Effect.acquireRelease(Effect.try({ try: () => subprocess.spawn(spec), catch: spawnFailure }), stopIndex)
  const control = handle.control
  if (control === undefined)
    return yield* new FffSearchError({ reason: 'fff-search started its index process without a control pipe; reload the plugin and retry.' })
  const socket = yield* NodeSocket.fromDuplex(Effect.succeed(control))
  const protocol = yield* RpcClient.makeProtocolSocket({ pingInterval: PING_INTERVAL, retryPolicy: Schedule.recurs(0) }).pipe(
    Effect.provideService(Socket.Socket, socket),
    Effect.provide(RpcSerialization.layerNdjson),
  )
  return yield* RpcClient.make(FffIndexRpcs).pipe(Effect.provideService(RpcClient.Protocol, protocol))
})

/**
 * The index process: every fff index lives in a child process DSH's subprocess service starts on the first search, so
 * neither its synchronous FFI calls nor its native threads can stop or crash the Host, and it runs in the same managed
 * range as every other command. The RPC runs on the process's private control pipe. A failed call drops the process; the
 * next search starts a new one. Closing the layer closes the pipe, which asks the process to exit, and terminates it
 * after 5 s.
 */
export class FffIndexWorker extends Context.Service<
  FffIndexWorker,
  {
    readonly warm: (root: string) => Call<void>
    readonly grep: (request: GrepRequest) => Call<typeof FffSearch.grepOutcome.Type>
    readonly glob: (request: GlobRequest) => Call<typeof FffSearch.globOutcome.Type>
  }
>()('@dshfiles/fff-search/FffIndexWorker') {
  static readonly layer = Layer.effect(
    FffIndexWorker,
    Effect.gen(function* () {
      // Started on first use and kept while the plugin lives: the indexes are the point of the process.
      const index = yield* RcRef.make({ acquire: startIndex, idleTimeToLive: Duration.infinity })
      const call = <A>(request: (client: Effect.Success<typeof startIndex>) => Effect.Effect<A, FffSearchError | RpcClientError.RpcClientError>): Call<A> =>
        Effect.scoped(
          Effect.flatMap(RcRef.get(index), client =>
            request(client).pipe(Effect.catchTag('RpcClientError', error => Effect.andThen(RcRef.invalidate(index), Effect.fail(transportFailure(error))))),
          ),
        ).pipe(
          Effect.timeoutOrElse({
            duration: REQUEST_TIMEOUT,
            orElse: () => Effect.fail(new FffSearchError({ reason: `fff-search did not answer within ${Duration.toSeconds(REQUEST_TIMEOUT)} s` })),
          }),
        )
      return FffIndexWorker.of({
        warm: root => call(client => client.Warm({ root })),
        grep: request => call(client => client.Grep(request)),
        glob: request => call(client => client.Glob(request)),
      })
    }),
  )
}
