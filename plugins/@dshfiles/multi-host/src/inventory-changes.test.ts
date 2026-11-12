import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Path, Stream } from 'effect'
import { HostDirectory } from './host-directory.js'
import { MultiHostPaths } from './paths.js'
import { RemoteThreads } from './remote-threads.js'

const stores = (dshHome: string) =>
  Layer.mergeAll(HostDirectory.layer, RemoteThreads.layer).pipe(
    Layer.provide(
      Layer.effect(
        MultiHostPaths,
        Effect.map(Path.Path, path => MultiHostPaths.make({ dshHome, path })),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  )

const scratchHome = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'multi-host-inventory-'))),
  home => Effect.promise(() => rm(home, { recursive: true, force: true })),
)

/** The `inventoryChanged` event follows these streams, so the sidebar reads the directory and thread list when they change. */
describe('multi-host inventory changes', () => {
  it.effect('announces a saved host and a recorded thread', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = yield* scratchHome
        yield* Effect.gen(function* () {
          const directory = yield* HostDirectory
          const threads = yield* RemoteThreads
          const directoryChanged = yield* directory.changes.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          const threadsChanged = yield* threads.changes.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          yield* Effect.yieldNow
          yield* directory.upsertHost({
            schemaVersion: 2,
            id: 'host-a',
            name: 'Build box',
            connector: { kind: 'ssh', sshTarget: 'build-box' },
            hidden: false,
            createdAt: '2026-11-04T00:00:00.000Z',
          })
          yield* threads.record({ runtimeId: 'runtime-a', sessionId: 'session-a', cwd: '/work', title: 'Fix it', createdAt: '2026-11-04T00:00:00.000Z' })
          expect(yield* Fiber.join(directoryChanged)).toHaveLength(1)
          expect(yield* Fiber.join(threadsChanged)).toHaveLength(1)
        }).pipe(Effect.provide(stores(home)))
      }),
    ),
  )
})
