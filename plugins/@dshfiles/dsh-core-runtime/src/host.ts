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
    await ctx.plugin(JsonlSessionPersistence, { root: config.sessionPersistenceRoot }).await()
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(AgentRegistry).await()
    await ctx.plugin(AgentLoop, { agents: [] }).await()
    await ctx.plugin(SessionController, { nativeOpen: canOpenNativePath() }).await()
    return () => undefined
  },
})
