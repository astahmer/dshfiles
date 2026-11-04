import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { agentWarmupApi } from './agent-warmup-api.ts'
import { composerControlsSettings } from './composer-controls-settings.ts'

class AgentWarmupFailure extends Schema.TaggedError<AgentWarmupFailure>()(
  'AgentWarmupFailure',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'agent-warmup-failure' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} could not be resumed ahead of its first send; sending still resumes it.`
  }
}

/** Resumes a thread's Agent before its first send, when this Host runs a Session controller. */
class AgentWarmups extends Context.Service<
  AgentWarmups,
  { readonly warm: (sessionId: SessionId) => Effect.Effect<{ readonly live: boolean }, AgentWarmupFailure> }
>()('@dshfiles/rich-composer/AgentWarmups') {
  static readonly layer = Layer.effect(
    AgentWarmups,
    Effect.gen(function* () {
      const controller = yield* Effect.option(hostService('sessionController'))
      return AgentWarmups.of({
        warm: Effect.fn('agent warmup')(function* (sessionId: SessionId) {
          if (Option.isNone(controller)) return { live: false }
          const resolved = yield* Effect.tryPromise({
            try: () => controller.value.resolveAgent(sessionId),
            catch: cause => new AgentWarmupFailure({ sessionId, cause }),
          })
          return { live: 'agent' in resolved }
        }),
      })
    }),
  )
}

export default DshxPlugin.make({
  name: 'dshfiles-rich-composer',
  settings: [composerControlsSettings],
  layer: AgentWarmups.layer,
  apis: [Api.bind(agentWarmupApi, { warm: input => AgentWarmups.use(warmups => warmups.warm(SessionId(input.sessionId))) })],
})
