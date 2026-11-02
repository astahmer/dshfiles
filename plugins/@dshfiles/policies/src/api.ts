import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { defineApi, method as defineMethod } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { Policies } from './policies.js'
import { strictStandardSchema } from './schema.js'

const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) => defineMethod({ ...options, input: strictStandardSchema(options.input), output: strictStandardSchema(options.output) })

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
