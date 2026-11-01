import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { method } from './api-schema.js'
import { AiAccountsSchema } from './effect-schema.js'

const routeSchema = Schema.Struct({
  sessionId: Schema.optional(AiAccountsSchema.id(128)),
  provider: AiAccountsSchema.id(128),
  model: AiAccountsSchema.id(256),
})

export const fastModeStatusSchema = Schema.Struct({
  available: Schema.Boolean,
  enabled: Schema.Boolean,
})

export type FastModeStatus = typeof fastModeStatusSchema.Type

export const aiAccountsFastModeApi = defineApi({
  id: 'ai-accounts-model-fast-mode',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    status: method({
      input: routeSchema,
      output: fastModeStatusSchema,
      description:
        'Read whether provider Fast mode is available and enabled for one session and exact model route. Agent callers may omit sessionId and are restricted to their own Session; other callers must provide it. Read-only.',
      tool: {
        name: 'ai_accounts_fast_mode_status',
        readOnly: true,
        render: output => JSON.stringify(output),
      },
    }),
    setFast: method({
      input: Schema.Struct({ ...routeSchema.fields, enabled: Schema.Boolean }),
      output: fastModeStatusSchema,
      description:
        'Set provider Fast mode for one session and exact model route. Agent callers may omit sessionId and can only target their own Session; other callers must provide it. Call only when the user asks to change Fast mode.',
      tool: {
        name: 'ai_accounts_set_fast_mode',
        readOnly: false,
        render: output => JSON.stringify(output),
      },
    }),
  },
})
