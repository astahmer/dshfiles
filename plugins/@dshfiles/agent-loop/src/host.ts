import type { Context } from '@deepseek-ai/cordis'
import AgentLoop from './native/index.ts'

/**
 * The native agent loop is a Cordis Service class; this Loader row hosts it unchanged, so the fork keeps the row
 * identity, injects and observability of the plugin it replaces.
 * @param ctx - owning context.
 */
export const apply = (ctx: Context): void => {
  ctx.plugin(AgentLoop)
}
