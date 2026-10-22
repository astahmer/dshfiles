import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const routeSchema = z
  .object({
    sessionId: z.string().min(1).max(128).optional(),
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
  })
  .strict()

export const fastModeStatusSchema = z
  .object({
    available: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()

export type FastModeStatus = z.infer<typeof fastModeStatusSchema>

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
      input: routeSchema.extend({ enabled: z.boolean() }).strict(),
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
