import { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineHost } from '@dshfiles/dshx/host'
import { agentWarmupApi } from './agent-warmup-api.ts'
import { composerControlsSettings } from './composer-controls-settings.ts'

const agentWarmupHost = agentWarmupApi.host({
  warm: async ({ ctx, input }) => {
    const resolved = await ctx.get('sessionController')?.resolveAgent(SessionId(input.sessionId))
    return { live: resolved !== undefined && 'agent' in resolved }
  },
})

export default defineHost({
  name: 'dshfiles-rich-composer',
  settings: [composerControlsSettings],
  apis: [agentWarmupHost],
})
