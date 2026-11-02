import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const routeSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
})

export const modelHandoffApi = defineApi({
  id: 'model-handoff',
  version: 1,
  owner: '@dshfiles/model-effort-picker',
  methods: {
    contextWindow: method({
      input: routeSchema,
      output: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
      description: 'Read the advertised context capacity for one exact provider/model route. Returns null when the route does not publish a capacity.',
      tool: {
        name: 'model_handoff_context_window',
        readOnly: true,
        render: output => JSON.stringify({ contextWindow: output }),
      },
    }),
  },
})
