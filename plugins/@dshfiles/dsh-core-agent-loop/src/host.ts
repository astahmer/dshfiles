import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { defineHost } from '@dshfiles/dshx/host'

/**
 * The maintained agent loop: the local fork of `@deepseek-ai/dsh-agent-loop`,
 * bundled into this entry so the profile loads it instead of the published one.
 * The fork advertises `agent/request-messages` through `forkFeatures`, which is
 * how a plugin can tell the capability is really installed.
 *
 * The composition starts it with the same empty agent list the native row used,
 * so this row is a drop-in for the one it replaces.
 */
export default defineHost({
  async setup(ctx) {
    await ctx.plugin(AgentLoop, { agents: [] }).await()
    return () => undefined
  },
})
