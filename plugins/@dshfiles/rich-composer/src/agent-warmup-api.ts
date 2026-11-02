import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const agentWarmupApi = defineApi({
  id: 'agent-warmup',
  version: 1,
  owner: '@dshfiles/rich-composer',
  methods: {
    warm: method({
      input: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)) }),
      output: Schema.Struct({ live: Schema.Boolean }),
      description: 'Resume a thread’s Agent ahead of its first send. Opening a thread no longer resumes it.',
    }),
  },
})
