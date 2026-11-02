import type {} from '@deepseek-ai/dsh-tools'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer } from 'effect'
import { policiesApi } from './api.js'
import { PolicyRules } from './policy-rules.js'
import { policiesSettings } from './settings.js'

const ToolGuard = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* hostService('tools')
    const rules = yield* PolicyRules
    yield* Effect.acquireRelease(
      Effect.sync(() => tools.guard(rules.guard)),
      dispose => Effect.sync(dispose),
    )
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/policies',
  inject: ['tools'],
  settings: [policiesSettings],
  layer: ToolGuard.pipe(Layer.provideMerge(PolicyRules.layer), Layer.provide(Settings.layer(policiesSettings))),
  apis: [
    Api.bind(policiesApi, {
      list: () => PolicyRules.use(rules => Effect.map(rules.list, list => ({ rules: [...list] }))),
      check: input =>
        PolicyRules.use(rules =>
          Effect.map(rules.check({ name: input.tool, arguments: input.arguments }), reason => ({ denied: reason !== undefined, reason: reason ?? null })),
        ),
    }),
  ],
})
