import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from './startup.js'
import { defineHost } from '@dshfiles/dshx/host'
import { LoopbackAccess } from './access.js'
import { loopbackAccessApi } from './api.js'
import { NetworkController } from './network-controller.js'

const runtimes = new WeakMap<Context, { access: LoopbackAccess; network: NetworkController }>()
const requireRuntime = (ctx: Context) => {
  const runtime = runtimes.get(ctx)
  if (runtime === undefined) throw new Error('Network access is not initialized. Restart DSH to load the matching Host plugin.')
  return runtime
}

const hostApi = loopbackAccessApi.host({
  status: ({ ctx }) => runtimes.get(ctx)?.access.status() ?? { state: 'stopped', upstreamOrigin: null, localhostOrigin: null, listeners: [] },
  network: ({ ctx }) => requireRuntime(ctx).network.snapshot(),
  saveNetwork: ({ ctx, input, signal }) => requireRuntime(ctx).network.save(input, signal),
})

export default defineHost({
  name: 'dshfiles-loopback-access',
  inject: ['webServer', 'webStartup', 'dshfilesNetworkStartup', 'settings', 'configEditor'],
  apis: [hostApi],
  setup: (ctx: Context) => {
    const access = new LoopbackAccess(ctx.webServer, ctx.dshfilesNetworkStartup.localhostEnabled)
    ctx.provide('dshfilesLoopbackAccess', access)
    const network = new NetworkController(ctx, access, ctx.dshfilesNetworkStartup)
    runtimes.set(ctx, { access, network })
    // Cordis owns this promised disposer, including a startup that settles after unload.
    return access.start().then(
      () => async () => {
        runtimes.delete(ctx)
        await access.close()
      },
      error => {
        runtimes.delete(ctx)
        throw error
      },
    )
  },
})
