import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const input = z.object({ sessionId: z.string().min(1).max(256), seq: z.number().int().nonnegative() }).strict()

export const interruptionApi = defineApi({
  id: 'chat-resume',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    available: method({
      description:
        'Check whether this exact stopped task is still latest and idle, and whether it is resumed (it had started answering) or retried (it produced nothing).',
      input,
      output: z.object({ available: z.boolean(), action: z.enum(['resume', 'retry']).optional() }),
      tool: {
        name: 'chat_stopped_turn_status',
        readOnly: true,
        render: output => (output.available ? `That task can be ${output.action === 'retry' ? 'retried' : 'resumed'}.` : 'That task is not waiting.'),
      },
    }),
    resume: method({
      description: 'Resume this exact interrupted task only when the user asks; refuses superseded or busy tasks.',
      input,
      output: z.object({ accepted: z.boolean() }),
      tool: { name: 'chat_resume_interrupted', render: output => (output.accepted ? 'Resume request queued.' : 'That task is no longer stopped.') },
    }),
    retry: method({
      description:
        'Run this exact stopped task again when it produced no reply (such as a sign-in or quota failure on its request) without adding a prompt; only when the user asks. Refuses superseded, busy or partly answered tasks.',
      input,
      output: z.object({ accepted: z.boolean() }),
      tool: { name: 'chat_retry_failed_turn', render: output => (output.accepted ? 'Retry queued.' : 'That task can no longer be retried.') },
    }),
  },
})
