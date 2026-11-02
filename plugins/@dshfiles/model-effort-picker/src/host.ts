import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Llm, type LlmRoute } from '@dshfiles/dshx/effect/llm'
import { Context, Effect, Layer, Schema } from 'effect'
import { modelHandoffApi } from './model-handoff-api.js'
import { modelEffortPickerSettings } from './settings.js'

class ModelHandoffFailure extends Schema.TaggedError<ModelHandoffFailure>()(
  'ModelHandoffFailure',
  { provider: Schema.String, model: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'model-handoff-failure' },
) {
  override get message(): string {
    return 'Could not resolve model context capacity.'
  }
}

/** The context capacity a provider/model route advertises, for the handoff estimate. */
class ModelContextWindows extends Context.Service<
  ModelContextWindows,
  { readonly read: (route: LlmRoute) => Effect.Effect<number | null, ModelHandoffFailure> }
>()('@dshfiles/model-effort-picker/ModelContextWindows') {
  static readonly layer = Layer.effect(
    ModelContextWindows,
    Effect.gen(function* () {
      const llm = yield* Llm
      return ModelContextWindows.of({
        read: Effect.fn('model context window read')(function* (route: LlmRoute) {
          const info = yield* llm
            .modelInfo(route)
            .pipe(Effect.mapError(cause => new ModelHandoffFailure({ provider: route.provider, model: route.model, cause })))
          return info.context?.contextWindow ?? null
        }),
      })
    }),
  )
}

export default DshxPlugin.make({
  name: '@dshfiles/model-effort-picker',
  inject: ['llm'],
  settings: [modelEffortPickerSettings],
  layer: ModelContextWindows.layer.pipe(Layer.provide(Llm.layer)),
  apis: [Api.bind(modelHandoffApi, { contextWindow: input => ModelContextWindows.use(windows => windows.read(input)) })],
})
