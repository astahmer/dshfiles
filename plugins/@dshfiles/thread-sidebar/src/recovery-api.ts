import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdInput = z.object({ sessionId: z.string().min(1).max(256) }).strict()
const sessionIdSchema = z.string().min(1).max(256)

const recoveryEntrySchema = z
  .object({
    sessionId: sessionIdSchema,
    reason: z.enum(['restart', 'interrupted']),
    interruptedAt: z.number().int().nonnegative(),
  })
  .strict()

const pendingOutput = z.object({
  /** Kept for Hosts that predate `entries`: the ids alone, in the same order. */
  sessionIds: z.array(sessionIdSchema).max(5000),
  entries: z.array(recoveryEntrySchema).max(5000).optional(),
})

const renderPending = (output: z.infer<typeof pendingOutput>): string => {
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
      input: z.void(),
      output: pendingOutput,
      tool: { name: 'thread_recoveries', readOnly: true, render: renderPending },
    }),
    resume: method({
      input: sessionIdInput,
      output: z.object({ accepted: z.boolean() }),
      tool: {
        name: 'thread_recovery_resume',
        render: output => (output.accepted ? 'Resume request queued.' : 'That thread is no longer waiting to be resumed.'),
      },
    }),
    dismiss: method({ input: sessionIdInput, output: z.object({ dismissed: z.boolean() }) }),
  },
})
