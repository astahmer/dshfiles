import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, FileSystem, Layer, Option, Path, Ref } from 'effect'
import { SessionLogFiles, SessionLogIndex } from './indexer.js'
import { Indexer, ToolRegistry } from './indexing.js'
import { Pricing } from './pricing.js'
import { AccountKindsTest, PlatformTest, usageRepoTest } from './test-layers.js'

/** The tool registry is another plugin; this stand-in counts reads and can hold a pass inside its first step. */
const registryTest = (input: { readonly reads: Ref.Ref<number>; readonly gate?: Deferred.Deferred<void> }) =>
  Layer.succeed(
    ToolRegistry,
    ToolRegistry.of({
      snapshot: Ref.update(input.reads, count => count + 1).pipe(
        Effect.andThen(input.gate === undefined ? Effect.void : Deferred.await(input.gate)),
        Effect.as(Option.none()),
      ),
    }),
  )

const indexerTest = (input: { readonly sessionsRoot: string; readonly registry: Layer.Layer<ToolRegistry> }) =>
  Indexer.layer({ sessionsRoot: input.sessionsRoot }).pipe(
    Layer.provide([SessionLogIndex.layer.pipe(Layer.provide(SessionLogFiles.layer)), Pricing.layer({ catalogPath: `${input.sessionsRoot}/pricing.json` })]),
    Layer.provide([input.registry, AccountKindsTest]),
    Layer.provideMerge(usageRepoTest()),
  )

const scratchRoot = Effect.flatMap(FileSystem.FileSystem, fileSystem => fileSystem.makeTempDirectoryScoped({ prefix: 'usage-indexing-' }))

describe('Indexer demand', () => {
  it.layer(PlatformTest)(it => {
    it.effect('runs the periodic catch-up pass only while something reads the ledger', () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0)
        const sessionsRoot = yield* scratchRoot
        yield* Effect.gen(function* () {
          const indexer = yield* Indexer
          // A Host nobody is looking at does not fold session logs.
          expect(yield* indexer.demanded).toBe(false)
          yield* indexer.touch
          expect(yield* indexer.demanded).toBe(true)
        }).pipe(Effect.provide(indexerTest({ sessionsRoot, registry: registryTest({ reads }) })))
      }),
    )
  })
})

describe('Indexer', () => {
  it.layer(PlatformTest)(it => {
    it.effect('joins a running pass instead of starting another', () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0)
        const sessionsRoot = yield* scratchRoot
        yield* Effect.gen(function* () {
          const indexer = yield* Indexer
          yield* Effect.all([indexer.pass, indexer.pass, indexer.pass], { concurrency: 'unbounded' })
          expect(yield* Ref.get(reads)).toBe(1)
          expect(yield* indexer.status).toMatchObject({ indexing: false, lastError: null, indexedFiles: 0, requests: 0 })
        }).pipe(Effect.provide(indexerTest({ sessionsRoot, registry: registryTest({ reads }) })))
      }),
    )

    it.effect('keeps a pass running when the refresh that started it is aborted', () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0)
        const gate = yield* Deferred.make<void>()
        const sessionsRoot = yield* scratchRoot
        yield* Effect.gen(function* () {
          const indexer = yield* Indexer
          const refresh = yield* Effect.forkChild(indexer.pass, { startImmediately: true })
          yield* Effect.yieldNow
          yield* Fiber.interrupt(refresh)
          expect((yield* indexer.status).indexing).toBe(true)
          yield* Deferred.succeed(gate, undefined)
          yield* indexer.pass
          expect(yield* Ref.get(reads)).toBe(1)
          expect((yield* indexer.status).lastIndexedAt).not.toBeNull()
        }).pipe(Effect.provide(indexerTest({ sessionsRoot, registry: registryTest({ reads, gate }) })))
      }),
    )

    it.effect('records a failed pass as the last error and clears it on the next good pass', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const reads = yield* Ref.make(0)
        const sessionsRoot = yield* scratchRoot
        const broken = path.join(sessionsRoot, 'project', 'session-x', 'session.v4.jsonl.zstd')
        yield* fileSystem.makeDirectory(path.dirname(broken), { recursive: true })
        yield* fileSystem.writeFileString(broken, 'not a zstandard frame')
        yield* Effect.gen(function* () {
          const indexer = yield* Indexer
          yield* indexer.pass
          const failed = yield* indexer.status
          expect(failed.lastIndexedAt).toBeNull()
          expect(failed.lastError).toMatch(/^Usage indexing failed at session-logs: Could not read the session log .*session-x/u)

          yield* fileSystem.remove(broken)
          yield* indexer.pass
          expect(yield* indexer.status).toMatchObject({ lastError: null, lastIndexedAt: expect.any(Number) })
        }).pipe(Effect.provide(indexerTest({ sessionsRoot, registry: registryTest({ reads }) })))
      }),
    )
  })
})
