import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import { DshxPlugin, HostContext, HostEvents, hostService } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { installRequestMessages } from './polyfill.ts'

const RequestMessagesPolyfill = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const runtime = yield* hostService('llm')
    yield* hostService('agents')
    const status = yield* installRequestMessages({ ctx: host.ctx, runtime })
    if (!status.active) host.ctx.logger('request-messages').warn('agent/request-messages is unavailable: %s', status.reason)
    yield* HostEvents.answer('request-messages/status', () => Effect.succeed(status))
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/request-messages',
  inject: ['llm', 'agents'],
  layer: RequestMessagesPolyfill,
})
