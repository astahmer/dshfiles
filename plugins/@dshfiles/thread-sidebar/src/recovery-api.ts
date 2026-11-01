import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdInput = SchemaHelpers.strictStruct(Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)) }))
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

const recoveryEntrySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    reason: Schema.Literals(['restart', 'interrupted']),
    interruptedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  }),
)

const pendingOutput = Schema.Struct({
  /** Kept for Hosts that predate `entries`: the ids alone, in the same order. */
  sessionIds: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(5000)),
  entries: Schema.optional(Schema.Array(recoveryEntrySchema).check(Schema.isMaxLength(5000))),
})

const renderPending = (output: Schema.Schema.Type<typeof pendingOutput>): string => {
  const entries = output.entries ?? output.sessionIds.map(sessionId => ({ sessionId, reason: 'restart' as const, interruptedAt: 0 }))
  if (entries.length === 0) return 'No thread is waiting to be resumed.'
  return entries
    .map(entry => `${entry.sessionId} — ${entry.reason === 'interrupted' ? 'turn interrupted when DSH stopped' : 'stopped for a managed restart'}`)
    .join('\n')
}

export const threadSidebarRecoveryApi = defineApi({
  id: 'thread-sidebar-recovery',
  version: 1,
  methods: {
    /** Threads whose turn was interrupted by a restart or an ungraceful exit and that nobody resumed yet. */
    pending: method({
      input: Schema.Void,
      output: pendingOutput,
      tool: { name: 'thread_recoveries', readOnly: true, render: renderPending },
    }),
    resume: method({
      input: sessionIdInput,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      tool: {
        name: 'thread_recovery_resume',
        render: output => (output.accepted ? 'Resume request queued.' : 'That thread is no longer waiting to be resumed.'),
      },
    }),
    dismiss: method({ input: sessionIdInput, output: Schema.Struct({ dismissed: Schema.Boolean }) }),
  },
})
