import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const input = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const interruptionApi = defineApi({
  id: 'chat-resume',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    available: method({
      description:
        'Check whether this exact stopped task is still latest and idle, and whether it is resumed (it had started answering) or retried (it produced nothing).',
      input,
      output: Schema.Struct({ available: Schema.Boolean, action: Schema.optional(Schema.Literals(['resume', 'retry'])) }),
      tool: {
        name: 'chat_stopped_turn_status',
        readOnly: true,
        render: output => (output.available ? `That task can be ${output.action === 'retry' ? 'retried' : 'resumed'}.` : 'That task is not waiting.'),
      },
    }),
    resume: method({
      description: 'Resume this exact interrupted task only when the user asks; refuses superseded or busy tasks.',
      input,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      tool: { name: 'chat_resume_interrupted', render: output => (output.accepted ? 'Resume request queued.' : 'That task is no longer stopped.') },
    }),
    retry: method({
      description:
        'Run this exact stopped task again when it produced no reply (such as a sign-in or quota failure on its request) without adding a prompt; only when the user asks. Refuses superseded, busy or partly answered tasks.',
      input,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      tool: { name: 'chat_retry_failed_turn', render: output => (output.accepted ? 'Retry queued.' : 'That task can no longer be retried.') },
    }),
  },
})
