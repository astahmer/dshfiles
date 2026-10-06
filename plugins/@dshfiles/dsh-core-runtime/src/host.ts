import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { defineHost } from '@dshfiles/dshx/host'

export default defineHost({
  setup(ctx) {
    ctx.plugin(SessionStore)
    ctx.plugin(AgentRegistry)
    ctx.plugin(AgentLoop, { agents: [] })
  },
})
