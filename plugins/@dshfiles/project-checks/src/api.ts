import { defineApi, method, type ApiCaller } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(128)
const actionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
const revisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/)

export const verifiedCompletionInputSchema = z
  .object({ sessionId: sessionIdSchema, turn: z.number().int().nonnegative().safe(), sourceRevision: revisionSchema })
  .strict()

export const completionAuthorizationResultSchema = z.object({ status: z.enum(['authorized', 'unavailable']) }).strict()

export const candidateVerificationInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    turn: z.number().int().nonnegative().safe(),
    sourceRevision: revisionSchema,
    expectedRevision: revisionSchema,
  })
  .strict()

export const candidateVerificationResultSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'stale', 'cancelled', 'unavailable', 'attempt-limit']),
    prompt: z.string().max(2_048).nullable(),
  })
  .strict()

export const mayVerifyCandidate = (caller: ApiCaller): boolean => caller.kind === 'plugin' && caller.packageId === '@dshfiles/jj-integration'

export const actionViewSchema = z.object({
  id: actionIdSchema,
  label: z.string().max(80),
  description: z.string().max(240),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  verifyBeforeComplete: z.boolean(),
})

export const receiptSchema = z.object({
  id: z.string().uuid(),
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  label: z.string().max(80),
  status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: z.enum(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed']).nullable(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  sourceRevision: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable(),
  sourceRevisionBefore: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable()
    .optional(),
  sourceRevisionAfter: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable()
    .optional(),
  configurationFreshness: z.literal('unknown').optional(),
  verificationTurn: z.number().int().nonnegative().nullable(),
  verificationStage: z.enum(['manual', 'completion', 'rebase']).optional(),
  automatic: z.boolean(),
  attempt: z.number().int().min(0).max(2),
  freshness: z.enum(['current', 'stale', 'unknown']),
})

export const hookEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  kind: z.enum(['invoked', 'result']),
  turn: z.number().int().nonnegative(),
  point: z.string().max(120),
  dialect: z.enum(['claude-code', 'codex']).nullable(),
  decision: z.string().max(40).nullable(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  stderrPresent: z.boolean(),
})

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const projectChecksApi = defineApi({
  id: 'project-checks',
  version: 1,
  owner: '@dshfiles/project-checks',
  methods: {
    actions: method({
      input: z.object({ sessionId: sessionIdSchema.optional() }),
      output: z.array(actionViewSchema).max(32),
      description:
        'The trusted project actions configured for a thread directory, with each action command line and where it applies. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_actions', readOnly: true, render: compactJson },
    }),
    receipts: method({
      input: z.object({ sessionId: sessionIdSchema.optional() }),
      output: z.array(receiptSchema).max(30),
      description:
        'Recent project-check receipts for a thread: what ran, its outcome, exit status, duration and whether it is still fresh against the working copy. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_receipts', readOnly: true, render: compactJson },
    }),
    hookEvents: method({
      input: z.object({ sessionId: sessionIdSchema.optional() }),
      output: z.array(hookEventSchema).max(12),
      description:
        'The native hook invocations and results recorded for a thread, so a skipped or failing hook is visible. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_hook_events', readOnly: true, render: compactJson },
    }),
    run: method({
      input: z.object({ sessionId: sessionIdSchema.optional(), actionId: actionIdSchema }),
      output: receiptSchema,
      description:
        'Run one configured project action in its thread directory and return the receipt. The action must be configured and visible for that directory. Defaults to the calling thread. Call only when the user asked to run that check.',
      tool: { name: 'project_checks_run', render: compactJson },
    }),
    assertVerifiedCompletion: method({
      input: verifiedCompletionInputSchema,
      output: completionAuthorizationResultSchema,
      description: 'Confirm a verified completion event is still active before jj-integration rebases its thread workspace.',
    }),
    verifyCandidate: method({
      input: candidateVerificationInputSchema,
      output: candidateVerificationResultSchema,
      description: 'Rerun trusted completion checks on one exact rebased candidate before jj-integration advances its bookmark.',
    }),
  },
})

export type CandidateVerificationInput = z.infer<typeof candidateVerificationInputSchema>
export type CandidateVerificationResult = z.infer<typeof candidateVerificationResultSchema>
export type ProjectActionView = z.infer<typeof actionViewSchema>
export type ProjectCheckReceipt = z.infer<typeof receiptSchema>
export type ProjectHookEvent = z.infer<typeof hookEventSchema>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-project-checks': { readonly kind: 'dshfiles-project-checks' }
  }
}
