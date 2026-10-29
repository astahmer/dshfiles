import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const routeSchema = z
  .object({
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
  })
  .strict()

export const modelHandoffApi = defineApi({
  id: 'model-handoff',
  version: 1,
  owner: '@dshfiles/model-effort-picker',
  methods: {
    contextWindow: method({
      input: routeSchema,
      output: z.number().int().positive().nullable(),
      description: 'Read the advertised context capacity for one exact provider/model route. Returns null when the route does not publish a capacity.',
      tool: {
        name: 'model_handoff_context_window',
        readOnly: true,
        render: output => JSON.stringify({ contextWindow: output }),
      },
    }),
  },
})
