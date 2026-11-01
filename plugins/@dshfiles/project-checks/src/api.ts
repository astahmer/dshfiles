import { defineApi, method, type ApiCaller } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'
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
import { exactSchema, openSchema } from './contract-schema.js'
import { durableAttemptStatusSchema, durableTaskProgressSchema, durableTaskStatusSchema } from './durable-tasks.js'

export { candidateVerificationResultSchema, completionAuthorizationResultSchema, hookEventSchema } from './api-effect-schemas.js'
export type { CandidateVerificationResult, ProjectHookEvent } from './api-effect-schemas.js'

const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const safeInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
const uuidSchema = Schema.String.check(Schema.isUUID())
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const actionIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u))
const revisionSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/u))
const taskIdSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))

export const verifiedCompletionInputSchema = Schema.Struct({ sessionId: sessionIdSchema, turn: safeInt, sourceRevision: revisionSchema })

export const candidateVerificationInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  turn: safeInt,
  sourceRevision: revisionSchema,
  expectedRevision: revisionSchema,
})

export const mayVerifyCandidate = (caller: ApiCaller): boolean => caller.kind === 'plugin' && caller.packageId === '@dshfiles/jj-integration'

export const receiptExecutorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({
    kind: Schema.Literal('remote'),
    remoteId: actionIdSchema,
    sshTarget: Schema.String.check(Schema.isMaxLength(255)),
    workspace: Schema.String.check(Schema.isMaxLength(2048)),
  }),
])

export const receiptRemoteFailureSchema = Schema.Struct({
  remoteId: actionIdSchema,
  code: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/u)),
  message: Schema.String.check(Schema.isMaxLength(240)),
})

export const actionViewSchema = Schema.Struct({
  id: actionIdSchema,
  label: Schema.String.check(Schema.isMaxLength(80)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  timeoutMs: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1_000), Schema.isLessThanOrEqualTo(300_000)),
  verifyBeforeComplete: Schema.Boolean,
  replayPolicy: Schema.Literals(['manual', 'read-only']).pipe(Schema.withDecodingDefaultKey(Effect.succeed<'manual' | 'read-only'>('manual'))),
  execution: Schema.Struct({
    target: Schema.Literals(['local', 'remote', 'auto']),
    remoteId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
    onRemoteFailure: Schema.Literals(['local', 'fail']),
  }),
})

const receiptFields = {
  id: uuidSchema,
  taskId: Schema.optionalKey(taskIdSchema),
  taskAttemptId: Schema.optionalKey(uuidSchema),
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  label: Schema.String.check(Schema.isMaxLength(80)),
  status: Schema.Literals(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: Schema.NullOr(
    Schema.Literals(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed', 'remote-unavailable', 'remote-failed']),
  ),
  executor: Schema.optionalKey(receiptExecutorSchema),
  remoteFailure: Schema.optionalKey(Schema.NullOr(receiptRemoteFailureSchema)),
  startedAt: countInt,
  finishedAt: countInt,
  durationMs: countInt,
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  sourceRevision: Schema.NullOr(revisionSchema),
  sourceRevisionBefore: Schema.optionalKey(Schema.NullOr(revisionSchema)),
  sourceRevisionAfter: Schema.optionalKey(Schema.NullOr(revisionSchema)),
  verificationTurn: Schema.NullOr(countInt),
  verificationStage: Schema.optionalKey(Schema.Literals(['manual', 'completion', 'rebase'])),
  automatic: Schema.Boolean,
  attempt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
}

/** A persisted receipt carries no computed freshness; the store never writes those fields. */
export const storedReceiptSchema = Schema.Struct(receiptFields)

export const receiptSchema = Schema.Struct({
  ...receiptFields,
  configurationFreshness: Schema.optionalKey(Schema.Literal('unknown')),
  freshness: Schema.Literals(['current', 'stale', 'unknown']),
})

export const durableTaskViewSchema = Schema.Struct({
  id: taskIdSchema,
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  label: Schema.String.check(Schema.isMaxLength(80)),
  status: durableTaskStatusSchema,
  progress: durableTaskProgressSchema,
  attemptCount: countInt,
  attempts: Schema.Array(
    Schema.Struct({
      id: uuidSchema,
      number: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
      status: durableAttemptStatusSchema,
      progress: durableTaskProgressSchema,
      startedAt: countInt,
      finishedAt: Schema.NullOr(countInt),
      exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
    }),
  ).check(Schema.isMaxLength(100)),
  createdAt: countInt,
  updatedAt: countInt,
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  errorCode: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
})

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const projectChecksApi = defineApi({
  id: 'project-checks',
  version: 1,
  owner: '@dshfiles/project-checks',
  methods: {
    actions: method({
      input: openSchema(actionsInputSchema),
      output: openSchema(Schema.Array(actionViewSchema).check(Schema.isMaxLength(32))),
      description:
        'The trusted project actions configured for a thread directory, with each action command line and where it applies. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_actions', readOnly: true, render: compactJson },
    }),
    receipts: method({
      input: openSchema(receiptsInputSchema),
      output: openSchema(Schema.Array(receiptSchema).check(Schema.isMaxLength(30))),
      description:
        'Recent project-check receipts for a thread: what ran, its outcome, exit status, duration and whether it is still fresh against the working copy. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_receipts', readOnly: true, render: compactJson },
    }),
    hookEvents: method({
      input: openSchema(hookEventsInputSchema),
      output: openSchema(hookEventsOutputSchema),
      description:
        'The native hook invocations and results recorded for a thread, so a skipped or failing hook is visible. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_hook_events', readOnly: true, render: compactJson },
    }),
    run: method({
      input: openSchema(runInputSchema),
      output: openSchema(receiptSchema),
      description:
        'Run one configured project action and return the receipt. The action may execute on a configured peer host; the receipt records the executor and any local fallback. It must be configured and visible for the thread directory. Defaults to the calling thread. Call only when the user asked to run that check.',
      tool: { name: 'project_checks_run', render: compactJson },
    }),
    dispatch: method({
      input: exactSchema(
        Schema.Struct({ sessionId: Schema.optionalKey(sessionIdSchema), actionId: actionIdSchema, idempotencyKey: uuidSchema }),
      ),
      output: openSchema(durableTaskViewSchema),
      description:
        'Durably dispatch one configured local project action and return its task record. This creates work and may execute a process; call only when the user asked. Reuse the same idempotencyKey to safely repeat dispatch after a lost response.',
      tool: { name: 'project_checks_dispatch', render: compactJson },
    }),
    tasks: method({
      input: openSchema(tasksInputSchema),
      output: openSchema(Schema.Array(durableTaskViewSchema).check(Schema.isMaxLength(100))),
      description: 'List durable project-check tasks for a thread, including interrupted/unknown work. Defaults to the calling thread. Read-only.',
      tool: { name: 'project_checks_tasks', readOnly: true, render: compactJson },
    }),
    cancelTask: method({
      input: openSchema(cancelTaskInputSchema),
      output: openSchema(durableTaskViewSchema),
      description:
        'Cancel a queued/running durable project-check task. A running task remains cancellation-pending until its subprocess confirms termination. Call only when the user asked.',
      tool: { name: 'project_checks_cancel', render: compactJson },
    }),
    retryTask: method({
      input: openSchema(retryTaskInputSchema),
      output: openSchema(durableTaskViewSchema),
      description:
        'Retry a failed, cancelled, timed-out or unknown durable task. The required confirmation acknowledges that the previous attempt may have applied external effects. Call only when the user explicitly asks to retry.',
      tool: { name: 'project_checks_retry', render: compactJson },
    }),
    assertVerifiedCompletion: method({
      input: exactSchema(verifiedCompletionInputSchema),
      output: openSchema(completionAuthorizationResultSchema),
      description: 'Confirm a verified completion event is still active before jj-integration rebases its thread workspace.',
    }),
    verifyCandidate: method({
      input: exactSchema(candidateVerificationInputSchema),
      output: openSchema(candidateVerificationResultSchema),
      description: 'Rerun trusted completion checks on one exact rebased candidate before jj-integration advances its bookmark.',
    }),
  },
})

export type CandidateVerificationInput = typeof candidateVerificationInputSchema.Type
export type ProjectActionView = typeof actionViewSchema.Type
export type ProjectCheckReceipt = typeof receiptSchema.Type
export type ProjectChecksTaskView = typeof durableTaskViewSchema.Type

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-project-checks': { readonly kind: 'dshfiles-project-checks' }
  }
}
