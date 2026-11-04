import type { Context } from '@deepseek-ai/cordis'
import { Effect, Schema } from 'effect'
import type { AttentionActRequest } from './attention-api.js'

/** The plugin that owns an inbox item threw while acting on it. */
export class AttentionActFailed extends Schema.TaggedError<AttentionActFailed>()('AttentionActFailed', {
  source: Schema.String,
  verb: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.source} provider failed to run ${this.verb}.`
  }
}

/**
 * The one Promise edge of the attention inbox: Cordis serial events are Promise-based, so handing a provider verb to
 * the plugin that owns the item crosses here.
 */
export const serialAttentionAct = (ctx: Context, request: AttentionActRequest): Effect.Effect<unknown, AttentionActFailed> =>
  Effect.tryPromise({
    try: () => ctx.serial('dshfiles/attention/act', request),
    catch: cause => new AttentionActFailed({ source: request.item.source, verb: request.verb, cause }),
  })
