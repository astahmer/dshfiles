import type { Context } from '@deepseek-ai/cordis'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'
import { z } from 'zod'

const overridesSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(0).max(65535).optional(),
})

/**
 * Read only explicit native Web CLI binding overrides. The installed startup
 * package exports WebStartupValues but does not augment Context.webStartup;
 * validate that untyped service boundary here rather than casting in plugins.
 * Added for loopback-access to preserve CLI priority without a local augmentation.
 */
export function readWebStartupOverrides(ctx: Context): Pick<WebStartupValues, 'host' | 'port'> {
  const raw: unknown = ctx.get('webStartup')
  const overrides = overridesSchema.parse(raw ?? {})
  const result: Pick<WebStartupValues, 'host' | 'port'> = {}
  if (overrides.host !== undefined) result.host = overrides.host
  if (overrides.port !== undefined) result.port = overrides.port
  return result
}
