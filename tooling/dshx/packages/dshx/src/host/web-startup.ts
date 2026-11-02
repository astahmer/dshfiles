import type { Context } from '@deepseek-ai/cordis'
import * as Schema from 'effect/Schema'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'

const overridesSchema = Schema.Struct({
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535))),
})

/**
 * Read only explicit native Web CLI binding overrides. The installed startup
 * package exports WebStartupValues but does not augment Context.webStartup;
 * validate that untyped service boundary here rather than casting in plugins.
 * Added for loopback-access to preserve CLI priority without a local augmentation.
 */
export function readWebStartupOverrides(ctx: Context): Pick<WebStartupValues, 'host' | 'port'> {
  const raw: unknown = ctx.get('webStartup')
  const overrides = Schema.decodeUnknownSync(overridesSchema)(raw ?? {})
  const result: Pick<WebStartupValues, 'host' | 'port'> = {}
  if (overrides.host !== undefined) result.host = overrides.host
  if (overrides.port !== undefined) result.port = overrides.port
  return result
}
