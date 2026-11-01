import { defineApi, method, type ApiCaller } from '@dshfiles/dshx/api'
import { z } from 'zod'
import {
  actionsInputSchema,
  cancelTaskInputSchema,
  candidateVerificationResultSchema,
  completionAuthorizationResultSchema,
  hookEventsInputSchema,
  hookEventsOutputSchema,
  receiptsInputSchema,
  retryTaskInputSchema,
  runInputSchema,
  tasksInputSchema,
} from './api-effect-schemas.js'
import { durableAttemptStatusSchema, durableTaskProgressSchema, durableTaskStatusSchema } from './durable-tasks.js'

export { candidateVerificationResultSchema, completionAuthorizationResultSchema, hookEventSchema } from './api-effect-schemas.js'
export type { CandidateVerificationResult, ProjectHookEvent } from './api-effect-schemas.js'

const sessionIdSchema = z.string().min(1).max(128)
const actionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
const revisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/)

export const verifiedCompletionInputSchema = z
  .object({ sessionId: sessionIdSchema, turn: z.number().int().nonnegative().safe(), sourceRevision: revisionSchema })
  .strict()

export const candidateVerificationInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    turn: z.number().int().nonnegative().safe(),
    sourceRevision: revisionSchema,
    expectedRevision: revisionSchema,
  })
  .strict()

export const mayVerifyCandidate = (caller: ApiCaller): boolean => caller.kind === 'plugin' && caller.packageId === '@dshfiles/jj-integration'

export const receiptExecutorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z
    .object({
      kind: z.literal('remote'),
      remoteId: actionIdSchema,
      sshTarget: z.string().max(255),
      workspace: z.string().max(2048),
    })
    .strict(),
])

export const receiptRemoteFailureSchema = z
  .object({
    remoteId: actionIdSchema,
    code: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    message: z.string().max(240),
  })
  .strict()

export const actionViewSchema = z.object({
  id: actionIdSchema,
  label: z.string().max(80),
  description: z.string().max(240),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  verifyBeforeComplete: z.boolean(),
  replayPolicy: z.enum(['manual', 'read-only']).default('manual'),
  execution: z
    .object({
      target: z.enum(['local', 'remote', 'auto']),
      remoteId: z.string().max(32).nullable(),
      onRemoteFailure: z.enum(['local', 'fail']),
    })
    .strict(),
})

export const receiptSchema = z.object({
  id: z.string().uuid(),
  taskId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  taskAttemptId: z.string().uuid().optional(),
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  label: z.string().max(80),
  status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: z.enum(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed', 'remote-unavailable', 'remote-failed']).nullable(),
  executor: receiptExecutorSchema.optional(),
  remoteFailure: receiptRemoteFailureSchema.nullable().optional(),
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

export const durableTaskViewSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: sessionIdSchema,
    actionId: actionIdSchema,
    label: z.string().max(80),
    status: durableTaskStatusSchema,
    progress: durableTaskProgressSchema,
    attemptCount: z.number().int().nonnegative(),
    attempts: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            number: z.number().int().min(1).max(100),
            status: durableAttemptStatusSchema,
            progress: durableTaskProgressSchema,
            startedAt: z.number().int().nonnegative(),
            finishedAt: z.number().int().nonnegative().nullable(),
            exitCode: z.number().int().nullable(),
          })
          .strict(),
      )
      .max(100),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    errorCode: z.string().max(64).nullable(),
  })
  .strict()

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const projectChecksApi = defineApi({
  id: 'project-checks',
  version: 1,
  owner: '@dshfiles/project-checks',
  methods: {
    actions: method({
      input: actionsInputSchema,
      output: z.array(actionViewSchema).max(32),
      description:
        'The trusted project actions configured for a thread directory, with each action command line and where it applies. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_actions', readOnly: true, render: compactJson },
    }),
    receipts: method({
      input: receiptsInputSchema,
      output: z.array(receiptSchema).max(30),
      description:
        'Recent project-check receipts for a thread: what ran, its outcome, exit status, duration and whether it is still fresh against the working copy. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_receipts', readOnly: true, render: compactJson },
    }),
    hookEvents: method({
      input: hookEventsInputSchema,
      output: hookEventsOutputSchema,
      description:
        'The native hook invocations and results recorded for a thread, so a skipped or failing hook is visible. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_hook_events', readOnly: true, render: compactJson },
    }),
    run: method({
      input: runInputSchema,
      output: receiptSchema,
      description:
        'Run one configured project action and return the receipt. The action may execute on a configured peer host; the receipt records the executor and any local fallback. It must be configured and visible for the thread directory. Defaults to the calling thread. Call only when the user asked to run that check.',
      tool: { name: 'project_checks_run', render: compactJson },
    }),
    dispatch: method({
      input: z.object({ sessionId: sessionIdSchema.optional(), actionId: actionIdSchema, idempotencyKey: z.string().uuid() }).strict(),
      output: durableTaskViewSchema,
      description:
        'Durably dispatch one configured local project action and return its task record. This creates work and may execute a process; call only when the user asked. Reuse the same idempotencyKey to safely repeat dispatch after a lost response.',
      tool: { name: 'project_checks_dispatch', render: compactJson },
    }),
    tasks: method({
      input: tasksInputSchema,
      output: z.array(durableTaskViewSchema).max(100),
      description: 'List durable project-check tasks for a thread, including interrupted/unknown work. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_tasks', readOnly: true, render: compactJson },
    }),
    cancelTask: method({
      input: cancelTaskInputSchema,
      output: durableTaskViewSchema,
      description:
        'Cancel a queued/running durable project-check task. A running task remains cancellation-pending until its subprocess confirms termination. Call only when the user asked.',
      tool: { name: 'project_checks_cancel', render: compactJson },
    }),
    retryTask: method({
      input: retryTaskInputSchema,
      output: durableTaskViewSchema,
      description:
        'Retry a failed, cancelled, timed-out or unknown durable task. The required confirmation acknowledges that the previous attempt may have applied external effects. Call only when the user explicitly asks to retry.',
      tool: { name: 'project_checks_retry', render: compactJson },
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
export type ProjectActionView = z.infer<typeof actionViewSchema>
export type ProjectCheckReceipt = z.infer<typeof receiptSchema>
export type ProjectChecksTaskView = z.infer<typeof durableTaskViewSchema>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-project-checks': { readonly kind: 'dshfiles-project-checks' }
  }
}
