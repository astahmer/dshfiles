import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { definePlugin } from '@dshfiles/dshx/host'
import { Config } from './config.js'
import { CursorAcpAdapter } from './cursor-acp-adapter.js'
import { createCursorRecoveryCommand } from './cursor-recovery-command.js'

export default definePlugin({
  id: 'dshfiles-cursor-agent',
  inject: ['agents', 'commands', 'credentials', 'storageDomain', 'subprocess'],
  setup(api) {
    const ctx: Context = api.raw.ctx
    const config = Config.parse(api.config)
    const agents = ctx.get('agents')
    if (agents === undefined) throw new Error('DSH agent registry is unavailable.')

    const adapter = new CursorAcpAdapter(ctx, config)
    const unregister = agents.registerRuntimeDriver(adapter)
    const unregisterCommand = ctx.commands.register(createCursorRecoveryCommand(adapter))
    api.lifecycle.onDispose(async () => {
      unregisterCommand()
      unregister()
      await adapter.dispose()
    })
  },
})
