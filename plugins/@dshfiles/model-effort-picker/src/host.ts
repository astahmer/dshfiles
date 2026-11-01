import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Schema } from 'effect'
import { modelHandoffApi } from './model-handoff-api.js'
import { modelEffortPickerSettings } from './settings.js'

class ModelHandoffFailure extends Schema.TaggedError<ModelHandoffFailure>()('ModelHandoffFailure', {
  message: Schema.String,
}) {}

class ModelHandoffRuntime extends Context.Service<ModelHandoffRuntime, { readonly resolveModelInfo: CordisContext['llm']['resolveModelInfo'] }>()(
  '@dshfiles/model-effort-picker/Runtime',
) {}

const rootLayer = (ctx: CordisContext) =>
  Layer.succeed(ModelHandoffRuntime, {
    resolveModelInfo: (provider, model) => ctx.llm.resolveModelInfo(provider, model),
  })

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: rootLayer, setup: () => Effect.void })

const modelHandoffHost = hostApi(modelHandoffApi, {
  contextWindow: Effect.fn('model handoff context window')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* ModelHandoffRuntime
      const model = yield* Effect.tryPromise({
        try: () => runtime.resolveModelInfo(input.provider, input.model),
        catch: () => new ModelHandoffFailure({ message: 'Could not resolve model context capacity.' }),
      })
      return model.context?.contextWindow ?? null
    }),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/model-effort-picker',
  inject: ['llm'],
  apis: [modelHandoffHost],
  settings: [modelEffortPickerSettings],
})
