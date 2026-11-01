import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import type { RequestMessagesStatus } from './contract.ts'
import { installRequestMessages } from './polyfill.ts'

class RequestMessagesSetupFailure extends Schema.TaggedError<RequestMessagesSetupFailure>()('RequestMessagesSetupFailure', {
  message: Schema.String,
}) {}

class RequestMessagesHost extends EffectContext.Service<RequestMessagesHost, { readonly ctx: Context; readonly runtime: NonNullable<Context['llm']> }>()(
  '@dshfiles/request-messages/Host',
) {}

const rootLayer = (ctx: Context) =>
  Layer.effect(
    RequestMessagesHost,
    Effect.try({
      try: () => {
        const runtime = ctx.get('llm')
        ctx.get('agents')
        if (runtime === undefined) throw new Error('The llm runtime service is unavailable.')
        return { ctx, runtime }
      },
      catch: error => new RequestMessagesSetupFailure({ message: error instanceof Error ? error.message : String(error) }),
    }),
  )

const setupRequestMessages = Effect.fn('request messages setup')(() =>
  Effect.gen(function* () {
    const host = yield* RequestMessagesHost
    const status: RequestMessagesStatus = yield* installRequestMessages(host.ctx, host.runtime, effect => Effect.runPromise(effect))
    if (!status.active) host.ctx.logger('request-messages').warn('agent/request-messages is unavailable: %s', status.reason)
    host.ctx.on('request-messages/status', () => status)
  }),
)

const effectPlugin = DshxEffect.plugin({ layer: rootLayer, setup: () => setupRequestMessages() })

export default defineHost({
  name: '@dshfiles/request-messages',
  inject: ['llm', 'agents'],
  setup: ctx => effectPlugin.setup(ctx, undefined),
})
