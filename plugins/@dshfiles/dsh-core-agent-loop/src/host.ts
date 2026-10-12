import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { defineHost } from '@dshfiles/dshx/host'

export default defineHost({
  async setup(ctx) {
    await ctx.plugin(AgentLoop, { agents: [] }).await()
    return () => undefined
  },
})
