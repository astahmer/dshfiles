import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { Policies } from './policies.js'

export const policiesApi = defineApi({
  id: 'policies',
  version: 1,
  owner: '@dshfiles/policies',
  methods: {
    list: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ rules: Schema.Array(Policies.ruleSchema) }),
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
      input: Schema.Struct({ tool: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)), arguments: Schema.optionalKey(Schema.Unknown) }),
      output: Schema.Struct({ denied: Schema.Boolean, reason: Schema.NullOr(Schema.String) }),
      description: 'Whether a tool call with these arguments would be denied by a policy, without running it. Read-only.',
      tool: { name: 'policy_check', readOnly: true, render: output => (output.denied ? (output.reason ?? 'Denied.') : 'No policy denies that call.') },
    }),
  },
})
