import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { canOpenNativePath } from '@deepseek-ai/dsh-native-command'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const Config = z.object({
  sessionPersistenceRoot: z.string().min(1),
})

export default defineHost({
  Config,
  async setup(ctx, config) {
    ctx.plugin(JsonlSessionPersistence, { root: config.sessionPersistenceRoot })
    ctx.plugin(SessionStore)
    ctx.plugin(AgentRegistry)
    ctx.plugin(AgentLoop, { agents: [] })
    const sessionController = ctx.plugin(SessionController, { nativeOpen: canOpenNativePath() })
    await sessionController
    return () => undefined
  },
})
