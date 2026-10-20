import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const agentWarmupApi = defineApi({
  id: 'agent-warmup',
  version: 1,
  owner: '@dshfiles/rich-composer',
  methods: {
    warm: method({
      input: z.object({ sessionId: z.string().min(1) }).strict(),
      output: z.object({ live: z.boolean() }).strict(),
      description: 'Resume a thread’s Agent ahead of its first send. Opening a thread no longer resumes it.',
    }),
  },
})
