import type { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import JsonlSessionPersistence from './session-persistence-jsonl.js'

export const Config = z.object({ sessionRoot: z.string().min(1) })

export const apply = (ctx: Context, config: z.infer<typeof Config>) => {
  ctx.plugin(SessionStore)
  ctx.plugin(JsonlSessionPersistence, { root: config.sessionRoot })
  ctx.plugin(AgentRegistry)
  ctx.plugin(AgentLoop, { agents: [] })
}
