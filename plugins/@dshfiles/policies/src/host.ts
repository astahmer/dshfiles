import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { defineApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
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

const api = policiesApi.host({
  list: () => ({ rules: [...rules()] }),
  check: ({ input }) => {
    const reason = Policies.guard(rules)({ name: input.tool, arguments: input.arguments })
    return { denied: reason !== undefined, reason: reason ?? null }
  },
})

export default defineHost({
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
  setup: (ctx: Context) => {
    ctx.effect(() => ctx.tools.guard(Policies.guard(rules)), 'policies: tool guard')
  },
})
