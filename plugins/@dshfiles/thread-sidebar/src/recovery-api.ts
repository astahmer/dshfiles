import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdInput = SchemaHelpers.toolInput({ sessionId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)) })
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const toolNames = Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128))).check(Schema.isMaxLength(20))

const recoveryEntrySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    reason: Schema.Literals(['restart', 'interrupted']),
    interruptedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
    /** Tool calls the managed restart cut off, by tool name. */
    openTools: Schema.optional(toolNames),
  }),
)

const autoResumeSchema = Schema.Struct({
  at: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  resumed: Schema.Array(Schema.Struct({ sessionId: sessionIdSchema, openTools: toolNames })).check(Schema.isMaxLength(5000)),
  skipped: Schema.Array(Schema.Struct({ sessionId: sessionIdSchema, reason: Schema.Literals(['over-limit', 'continued', 'failed', 'crash']) })).check(
    Schema.isMaxLength(5000),
  ),
})

const pendingOutput = Schema.Struct({
  /** Kept for Hosts that predate `entries`: the ids alone, in the same order. */
  sessionIds: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(5000)),
  entries: Schema.optional(Schema.Array(recoveryEntrySchema).check(Schema.isMaxLength(5000))),
  /** What the opt-in automatic resume did after this Host booted; absent when it did not run. */
  autoResume: Schema.optional(autoResumeSchema),
})

const SKIP_COPY = {
  'over-limit': 'over the automatic-resume limit',
  continued: 'it had already continued',
  failed: 'the resume request failed',
  crash: 'a crash or forced stop, not a managed restart',
} as const

const renderPending = (output: Schema.Schema.Type<typeof pendingOutput>): string => {
  const entries = output.entries ?? output.sessionIds.map(sessionId => ({ sessionId, reason: 'restart' as const, interruptedAt: 0, openTools: undefined }))
  const pending =
    entries.length === 0
      ? ['No thread is waiting to be resumed.']
      : entries.map(
          entry =>
            `${entry.sessionId} — ${entry.reason === 'interrupted' ? 'turn interrupted when DSH stopped' : 'stopped for a managed restart'}${entry.openTools === undefined || entry.openTools.length === 0 ? '' : ` (cut off: ${entry.openTools.join(', ')})`}`,
        )
  const auto = output.autoResume
  if (auto === undefined) return pending.join('\n')
  return [
    ...pending,
    `Automatic resume after this boot: ${String(auto.resumed.length)} resumed, ${String(auto.skipped.length)} skipped.`,
    ...auto.resumed.map(entry => `${entry.sessionId} — resumed automatically`),
    ...auto.skipped.map(entry => `${entry.sessionId} — not resumed: ${SKIP_COPY[entry.reason]}`),
  ].join('\n')
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
