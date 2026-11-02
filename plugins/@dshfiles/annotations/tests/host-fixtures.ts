import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { NodeFileSystem } from '@effect/platform-node'
import { Effect, FileSystem, Layer } from 'effect'

const cordisHost = (setup: (ctx: CordisContext) => Promise<unknown>) =>
  Layer.effect(
    HostContext,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const ctx = new CordisContext()
        await setup(ctx)
        return ctx
      }),
      ctx => Effect.promise(() => ctx.fiber.dispose()),
    ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/annotations' }))),
  )

/** DSH's real subprocess runtime behind Effect's ChildProcessSpawner. */
export const SpawnerLive = DshChildProcessSpawner.layer.pipe(
  Layer.provide(
    cordisHost(async ctx => {
      await ctx.plugin(LocalSubprocessRuntime)
    }),
  ),
)

/** DSH's real storage domain facility on a scratch JSON backend. */
export const StorageDomainLive = StorageDomain.layer.pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'dsh-annotations-storage-' })
        return cordisHost(async ctx => {
          await ctx.plugin(Storage)
          await ctx.plugin(StorageJson, { root })
          await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
        })
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer)),
  ),
)
