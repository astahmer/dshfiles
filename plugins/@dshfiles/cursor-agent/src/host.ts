import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { definePlugin } from '@dshfiles/dshx/host'
import { Config } from './config.js'
import { CursorAcpAdapter } from './cursor-acp-adapter.js'

export default definePlugin({
  id: 'dshfiles-cursor-agent',
  inject: ['agents', 'credentials', 'storageDomain', 'subprocess'],
  setup(api) {
    const ctx: Context = api.raw.ctx
    const config = Config.parse(api.config)
    const agents = ctx.get('agents')
    if (agents === undefined) throw new Error('DSH agent registry is unavailable.')

    const adapter = new CursorAcpAdapter(ctx, config)
    const unregister = agents.registerRuntimeDriver(adapter)
    api.lifecycle.onDispose(async () => {
      unregister()
      await adapter.dispose()
    })
  },
})
