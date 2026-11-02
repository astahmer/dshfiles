import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { Context, Effect, Layer, Schema } from 'effect'
import { policiesApi } from './api.js'
import { Policies, type PolicyRule } from './policies.js'
import { policiesSettings } from './settings.js'

type PoliciesSettings = SettingsValue<typeof policiesSettings.schema>

let settingsScope: SettingsScope<PoliciesSettings> | undefined

const rules = (): readonly PolicyRule[] => {
  try {
    return settingsScope?.get().rules ?? []
  } catch {
    return []
  }
}

class PoliciesToolsUnavailable extends Schema.TaggedError<PoliciesToolsUnavailable>()('PoliciesToolsUnavailable', {
  message: Schema.String,
}) {}

class PoliciesRuntime extends Context.Service<
  PoliciesRuntime,
  {
    readonly rules: () => readonly PolicyRule[]
    readonly installGuard: (guard: (execution: { readonly name: string; readonly arguments: unknown }) => string | undefined) => () => void
  }
>()('@dshfiles/policies/Runtime') {}

const policiesLayer = (ctx: CordisContext) => {
  const tools = ctx.get('tools')
  if (tools === undefined) throw new PoliciesToolsUnavailable({ message: 'The tools service is unavailable.' })
  return Layer.succeed(PoliciesRuntime, {
    rules,
    installGuard: guard => tools.guard(guard),
  })
}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: policiesLayer,
  setup: () =>
    Effect.gen(function* () {
      const runtime = yield* PoliciesRuntime
      yield* Effect.acquireRelease(
        Effect.sync(() => runtime.installGuard(Policies.guard(runtime.rules))),
        dispose => Effect.sync(dispose),
      )
    }),
})

const api = hostApi(policiesApi, {
  list: Effect.fn('policies list')(() => PoliciesRuntime.use(runtime => Effect.sync(() => ({ rules: [...runtime.rules()] })))),
  check: Effect.fn('policies check')(({ input }) =>
    PoliciesRuntime.use(runtime =>
      Effect.sync(() => {
        const reason = Policies.guard(runtime.rules)({ name: input.tool, arguments: input.arguments })
        return { denied: reason !== undefined, reason: reason ?? null }
      }),
    ),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/policies',
  inject: ['tools'],
  settings: [
    policiesSettings.host({
      setup: scope => {
        settingsScope = scope
        return () => {
          if (settingsScope === scope) settingsScope = undefined
        }
      },
    }),
  ],
  apis: [api],
})
