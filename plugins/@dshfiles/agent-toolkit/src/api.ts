import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const agentToolkitApi = defineApi({
  id: 'agent-toolkit',
  version: 1,
  owner: '@dshfiles/agent-toolkit',
  methods: {
    versions: method({
      input: Schema.Struct({
        packages: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))).check(Schema.isMaxLength(500)),
      }),
      output: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      description: 'The installed version of each package as the current DSH profile resolves it; null when it cannot be found.',
    }),
  },
})
