import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Schema } from 'effect'
import { agentWarmupApi } from './agent-warmup-api.ts'
import { composerControlsSettings } from './composer-controls-settings.ts'

class AgentWarmupRuntime extends Context.Service<AgentWarmupRuntime, { readonly sessionController: ReturnType<CordisContext['get']> }>()(
  '@dshfiles/rich-composer/AgentWarmupRuntime',
) {}

class AgentWarmupFailure extends Schema.TaggedError<AgentWarmupFailure>()('AgentWarmupFailure', {
  message: Schema.String,
}) {}

const agentWarmupLayer = (ctx: CordisContext) =>
  Layer.succeed(AgentWarmupRuntime, {
    sessionController: ctx.get('sessionController'),
  })

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: agentWarmupLayer,
  setup: () => Effect.void,
})

const agentWarmupHost = hostApi(agentWarmupApi, {
  warm: Effect.fn('agent warmup')(({ input }) =>
    AgentWarmupRuntime.use(runtime => {
      if (runtime.sessionController === undefined) return Effect.succeed({ live: false })
      return Effect.tryPromise({
        try: () => runtime.sessionController.resolveAgent(SessionId(input.sessionId)),
        catch: error => new AgentWarmupFailure({ message: error instanceof Error ? error.message : String(error) }),
      }).pipe(Effect.map(resolved => ({ live: resolved !== null && typeof resolved === 'object' && 'agent' in resolved })))
    }),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: 'dshfiles-rich-composer',
  settings: [composerControlsSettings],
  apis: [agentWarmupHost],
})
