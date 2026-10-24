import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { defineHost } from '@dshfiles/dshx/host'
import { LoopbackAccess } from './access.js'
import { loopbackAccessApi } from './api.js'

const runtimes = new WeakMap<Context, LoopbackAccess>()

const hostApi = loopbackAccessApi.host({
  status: ({ ctx }) => runtimes.get(ctx)?.status() ?? { state: 'stopped', upstreamOrigin: null, localhostOrigin: null, listeners: [] },
})

export default defineHost({
  name: 'dshfiles-loopback-access',
  inject: ['webServer'],
  apis: [hostApi],
  setup: (ctx: Context) => {
    const active = new LoopbackAccess(ctx.webServer)
    runtimes.set(ctx, active)
    // Cordis owns this promised disposer, including a startup that settles after unload.
    return active.start().then(
      () => async () => {
        runtimes.delete(ctx)
        await active.close()
      },
      error => {
        runtimes.delete(ctx)
        throw error
      },
    )
  },
})
