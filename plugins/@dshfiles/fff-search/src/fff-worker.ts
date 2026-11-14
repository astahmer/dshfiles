/**
 * The fff index process. fff-node's queries are synchronous FFI calls that take from milliseconds to seconds, and its
 * native library runs threads of its own that crash the whole process when a worker thread holding it is torn down
 * (any terminate or exit of such a worker segfaulted the Host on every restart). So every index lives in this child
 * process, on its main thread, which DSH's subprocess service starts with a private control pipe on fd 7. The RPC runs
 * on that pipe; when the Host closes it (or dies), this process exits.
 */
import { FileFinder } from '@ff-labs/fff-node'
import { openInheritedControlChannel } from '@deepseek-ai/dsh-subprocess/control'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeSink from '@effect/platform-node/NodeSink'
import * as NodeStream from '@effect/platform-node/NodeStream'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Duration, Effect, Layer, PlatformError, Schedule, Schema, Stdio } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import { evictableIndex, IDLE_INDEX_MS, pruneStores } from './index-eviction.js'
import { fffIndexConfig, FffIndexRpcs } from './fff-index-protocol.js'
import { FffSearch, FffSearchError } from './fff-search.js'

const { stateRoot } = Schema.decodeUnknownSync(fffIndexConfig)(process.argv[2])

/** `scanned` is enough for path globs; content search waits for `contentReady`. */
type ResidentIndex = { finder: FileFinder; scanned: Promise<unknown>; contentReady: Promise<unknown>; lastUsedAt: number; inUse: number }

const failure = (what: string) => (cause: unknown) =>
  new FffSearchError({ reason: cause instanceof Error ? cause.message : `fff-search ${what} failed`, cause })

const Handlers = FffIndexRpcs.toLayer(
  Effect.gen(function* () {
    const indexes = new Map<string, ResidentIndex>()
    // A deleted thread workspace leaves its search history behind; drop those stores before serving this run.
    pruneStores(stateRoot)

    const indexFor = (root: string): ResidentIndex => {
      const existing = indexes.get(root)
      if (existing !== undefined) {
        existing.lastUsedAt = Date.now()
        return existing
      }
      const stateDirectory = join(stateRoot, createHash('sha256').update(root).digest('hex').slice(0, 16))
      mkdirSync(stateDirectory, { recursive: true })
      // The directory name is a hash, so record the root it belongs to: a pruning pass can then drop the stores of
      // roots that no longer exist instead of keeping every workspace this machine ever indexed (2,099 of 2,152 here).
      writeFileSync(join(stateDirectory, 'root.txt'), root)
      const created = FileFinder.create({
        basePath: root,
        frecencyDbPath: join(stateDirectory, 'frecency.db'),
        historyDbPath: join(stateDirectory, 'history.db'),
      })
      if (!created.ok) throw new FffSearchError({ reason: `fff-search could not index ${root}: ${created.error}` })
      const index = {
        finder: created.value,
        scanned: created.value.waitForScan(60_000),
        contentReady: created.value.waitForIndexReady(60_000),
        lastUsedAt: Date.now(),
        inUse: 0,
      }
      indexes.set(root, index)
      return index
    }

    /** Hold the root's index for one query: an index in use is never evicted. */
    const withIndex = <A>(root: string, query: (index: ResidentIndex) => Promise<A>) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const index = indexFor(root)
          index.inUse += 1
          return index
        }),
        index => Effect.tryPromise({ try: () => query(index), catch: failure('search') }),
        index =>
          Effect.sync(() => {
            index.inUse -= 1
            index.lastUsedAt = Date.now()
          }),
      )

    const evictIdle = Effect.sync(() => {
      const now = Date.now()
      for (const [root, index] of indexes) {
        if (!evictableIndex(index, now)) continue
        indexes.delete(root)
        index.finder.destroy()
      }
    })
    yield* evictIdle.pipe(Effect.repeat(Schedule.spaced(Duration.millis(IDLE_INDEX_MS / 3))), Effect.forkScoped)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const index of indexes.values()) index.finder.destroy()
        indexes.clear()
      }),
    )

    return {
      Warm: ({ root }) => Effect.try({ try: () => void indexFor(root), catch: failure('warm-up') }),
      Grep: request =>
        withIndex(request.scope.root, async index => {
          await index.contentReady
          return FffSearch.grep({
            finder: index.finder,
            scope: request.scope,
            pattern: request.pattern,
            include: request.include,
            workingDirectory: request.workingDirectory,
          })
        }),
      Glob: request =>
        withIndex(request.scope.root, async index => {
          await index.scanned
          return FffSearch.glob({ finder: index.finder, scope: request.scope, pattern: request.pattern, workingDirectory: request.workingDirectory })
        }),
    }
  }),
)

/** The inherited control pipe, opened before anything else runs; it carries the RPC both ways. */
const control = openInheritedControlChannel()

const pipeError = (method: string) => (cause: unknown) =>
  PlatformError.systemError({ _tag: 'Unknown', module: 'Stdio', method, pathOrDescriptor: 'control pipe', cause })

/** The RPC's stdio is the control pipe; this process's own stdout and stderr stay the Host's diagnostics. */
const controlStdio = Stdio.make({
  args: Effect.succeed(process.argv.slice(2)),
  stdin: NodeStream.fromReadable({ evaluate: () => control, onError: pipeError('stdin') }),
  stdout: () => NodeSink.fromWritable({ evaluate: () => control, onError: pipeError('stdout'), endOnDone: false }),
  stderr: () => NodeSink.fromWritable({ evaluate: () => process.stderr, onError: pipeError('stderr'), endOnDone: false }),
})

const IndexServer = RpcServer.layer(FffIndexRpcs).pipe(
  Layer.provide(Handlers),
  Layer.provide(RpcServer.layerProtocolStdio),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(Layer.succeed(Stdio.Stdio, controlStdio)),
)

/** The Host closes its end to ask this process to exit; a Host that died closes it too. */
const pipeClosed = Effect.callback<void>(resume => {
  const closed = () => resume(Effect.void)
  control.once('end', closed)
  control.once('close', closed)
  return Effect.sync(() => {
    control.off('end', closed)
    control.off('close', closed)
  })
})

NodeRuntime.runMain(Effect.raceFirst(Layer.launch(IndexServer), pipeClosed))
