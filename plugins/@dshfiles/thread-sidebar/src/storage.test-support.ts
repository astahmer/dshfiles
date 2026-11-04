import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Effect, Layer } from 'effect'

/** A real Cordis context with DSH's JSON storage-domain backend rooted in `root`, disposed with the layer. */
export const jsonStorageDomain = (root: string) =>
  StorageDomain.layer.pipe(
    Layer.provideMerge(
      Layer.effect(
        HostContext,
        Effect.acquireRelease(
          Effect.promise(async () => {
            const ctx = new CordisContext()
            await ctx.plugin(Storage)
            await ctx.plugin(StorageJson, { root })
            await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
            return ctx
          }),
          ctx => Effect.promise(() => ctx.fiber.dispose()),
        ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/thread-sidebar' }))),
      ),
    ),
  )
