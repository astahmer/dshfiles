import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { defineHost } from '@dshfiles/dshx/host'

/**
 * The maintained agent runtime: the local forks of `@deepseek-ai/dsh-agent` and
 * `@deepseek-ai/dsh-agent-loop`, bundled into this entry so the profile loads
 * them instead of the published copies.
 *
 * Both rows are replaced because the fork loop consumes fork-only exports from
 * the fork agent — `runtimeDriverEventSchema` and
 * `runtimeDriverPromptResultSchema` do not exist in the published agent, so a
 * loop-only swap fails to instantiate with a missing-export SyntaxError.
 *
 * The loop advertises `agent/request-messages` through `forkFeatures`, which is
 * how a plugin can tell the capability is really installed. Everything else —
 * the session store, JSONL persistence and the session controller that
 * provisions a jj workspace per thread — stays native.
 */
export default defineHost({
  async setup(ctx) {
    await ctx.plugin(AgentRegistry).await()
    await ctx.plugin(AgentLoop, { agents: [] }).await()
    return () => undefined
  },
})
