import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { Context, Effect, Layer, Schema } from 'effect'
import { z } from 'zod'
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

const policiesApi = defineApi({
  id: 'policies',
  version: 1,
  owner: '@dshfiles/policies',
  methods: {
    list: method({
      input: z.object({}).strict(),
      output: z.object({ rules: z.array(Policies.ruleSchema) }).strict(),
      description: 'List the deny policies the user set: tool pattern, argument pattern, reason and whether each is on. Read-only.',
      tool: {
        name: 'policies_list',
        readOnly: true,
        render: output =>
          output.rules
            .map(
              rule =>
                `${rule.enabled ? '' : '(off) '}${rule.name === '' ? rule.tool : rule.name} · tool ${rule.tool}${rule.match === '' ? '' : ` · arguments /${rule.match}/`}${rule.reason === '' ? '' : ` · ${rule.reason}`}`,
            )
            .join('\n') || 'No policies are set.',
      },
    }),
    check: method({
      input: z.object({ tool: z.string().min(1).max(200), arguments: z.unknown().optional() }).strict(),
      output: z.object({ denied: z.boolean(), reason: z.string().nullable() }).strict(),
      description: 'Whether a tool call with these arguments would be denied by a policy, without running it. Read-only.',
      tool: { name: 'policy_check', readOnly: true, render: output => (output.denied ? (output.reason ?? 'Denied.') : 'No policy denies that call.') },
    }),
  },
})

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
