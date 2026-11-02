import { Context as EffectContext, Effect, Layer } from 'effect'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from './startup.js'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { LoopbackAccess } from './access.js'
import { loopbackAccessApi } from './api.js'
import { NetworkController } from './network-controller.js'

class LoopbackRuntime extends EffectContext.Service<LoopbackRuntime, { readonly access: LoopbackAccess; readonly network: NetworkController }>()(
  'dshfiles/loopback-access/LoopbackRuntime',
) {}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: (ctx: Context) =>
    Layer.effect(
      LoopbackRuntime,
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const access = new LoopbackAccess(ctx.webServer)
            await access.start()
            return { access, network: new NetworkController(ctx, access, ctx.dshfilesNetworkStartup) }
          },
          catch: error => error,
        }),
        runtime => Effect.promise(() => runtime.access.close()),
      ),
    ),
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const runtime = yield* LoopbackRuntime
      ctx.provide('dshfilesLoopbackAccess', runtime.access)
    }),
})

const api = hostApi(loopbackAccessApi, {
  status: Effect.fn('loopback access status')(() => LoopbackRuntime.use(runtime => Effect.sync(() => runtime.access.status()))),
  network: Effect.fn('network access read')(() => LoopbackRuntime.use(runtime => Effect.sync(() => runtime.network.snapshot()))),
  saveNetwork: Effect.fn('network access save')(({ input, signal }) =>
    LoopbackRuntime.use(runtime =>
      Effect.tryPromise({
        try: () => runtime.network.save(input, signal),
        catch: error => error,
      }),
    ),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: 'dshfiles-loopback-access',
  inject: ['webServer', 'webStartup', 'dshfilesNetworkStartup', 'settings', 'configEditor'],
  apis: [api],
})
