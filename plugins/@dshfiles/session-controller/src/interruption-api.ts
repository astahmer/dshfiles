import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const input = z.object({ sessionId: z.string().min(1).max(256), seq: z.number().int().nonnegative() }).strict()

export const interruptionApi = defineApi({
  id: 'chat-resume',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    available: method({
      description: 'Check whether this exact interrupted task is still latest and idle.',
      input,
      output: z.object({ available: z.boolean() }),
    }),
    resume: method({
      description: 'Resume this exact interrupted task only when the user asks; refuses superseded or busy tasks.',
      input,
      output: z.object({ accepted: z.boolean() }),
      tool: { name: 'chat_resume_interrupted', render: output => (output.accepted ? 'Resume request queued.' : 'That task is no longer stopped.') },
    }),
  },
})
