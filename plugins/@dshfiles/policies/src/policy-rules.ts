import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Context, Effect, Layer, Ref, Stream } from 'effect'
import { Policies, type PolicyRule } from './policies.js'
import { policiesSettings } from './settings.js'

interface ToolCall {
  readonly name: string
  readonly arguments: unknown
}

const PoliciesSettings = Settings.Tag<SettingsValue<typeof policiesSettings.schema>>(policiesSettings.namespace)

/** The deny rules the user set, kept current with every committed settings revision. */
export class PolicyRules extends Context.Service<
  PolicyRules,
  {
    readonly list: Effect.Effect<readonly PolicyRule[]>
    readonly check: (call: ToolCall) => Effect.Effect<string | undefined>
    /** The same check for the Host's synchronous tool guard. */
    readonly guard: (call: ToolCall) => string | undefined
  }
>()('@dshfiles/policies/PolicyRules') {
  static readonly layer = Layer.effect(
    PolicyRules,
    Effect.gen(function* () {
      const settings = yield* PoliciesSettings
      const current = yield* Ref.make<readonly PolicyRule[]>((yield* settings.get).rules)
      yield* settings.changes.pipe(
        Stream.runForEach(value => Ref.set(current, value.rules)),
        Effect.forkScoped,
      )
      const guard = Policies.guard(() => Ref.getUnsafe(current))
      return PolicyRules.of({
        list: Ref.get(current),
        check: Effect.fn('policies check')(function* (call: ToolCall) {
          const rules = yield* Ref.get(current)
          const rule = Policies.denying(rules, call)
          return rule === undefined ? undefined : Policies.refusal(rule)
        }),
        guard,
      })
    }),
  )
}
