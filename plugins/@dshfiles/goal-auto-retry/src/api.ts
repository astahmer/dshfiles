import { defineApi, event, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const epochMsSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt())
const minutesSchema = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1440))

export const retryFailureSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  resetAt: Schema.optional(epochMsSchema),
})
export type RetryFailureView = typeof retryFailureSchema.Type

export const pendingRetrySchema = Schema.Struct({
  sessionId: sessionIdSchema,
  goalId: Schema.String,
  revision: Schema.Number,
  attempt: Schema.Number,
  at: epochMsSchema,
  delayMs: Schema.Number,
  source: Schema.Literals(['override', 'reset', 'backoff']),
  failure: retryFailureSchema,
})
export type PendingRetryView = typeof pendingRetrySchema.Type

export const armingSchema = Schema.Struct({
  enabled: Schema.Boolean,
  delayMinutes: Schema.Number,
})
export type ArmingView = typeof armingSchema.Type

const idle = Schema.Struct({ kind: Schema.Literal('idle'), arming: armingSchema })
const scheduled = Schema.Struct({ kind: Schema.Literal('scheduled'), retry: pendingRetrySchema, arming: armingSchema })
const failed = Schema.Struct({ kind: Schema.Literal('failed'), retry: pendingRetrySchema, reason: Schema.String, arming: armingSchema })

export const retryStatusSchema = Schema.Union([idle, scheduled, failed])
export type RetryStatusView = typeof retryStatusSchema.Type

const statusInput = Schema.Struct({ sessionId: sessionIdSchema })
const renderJson = (output: RetryStatusView): string => JSON.stringify(output)

/**
 * The composer chip arms and reads one thread's automatic goal retry; a Host
 * timer does the resuming, so it survives the browser tab closing.
 */
export const goalAutoRetryApi = defineApi({
  id: 'goal-auto-retry',
  version: 1,
  owner: '@dshfiles/goal-auto-retry',
  methods: {
    status: method({
      input: statusInput,
      output: retryStatusSchema,
      description: 'Read a thread’s automatic goal retry: whether the chip is armed, and its pending or failed attempt. Read-only.',
      tool: { name: 'goal_auto_retry_status', readOnly: true, render: renderJson },
    }),
    arm: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, enabled: Schema.Boolean, delayMinutes: minutesSchema }),
      output: retryStatusSchema,
      description:
        'Turn automatic goal retry on or off for one thread. Call only when the user asked to change it; an armed thread resumes its goal without further confirmation after a quota, rate limit or account refusal, which spends tokens on later rounds.',
      tool: { name: 'goal_auto_retry_arm', readOnly: false, render: renderJson },
    }),
    schedule: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        /** Minutes from now; omitted follows the reset the provider announced. */
        delayMinutes: Schema.optional(minutesSchema),
      }),
      output: retryStatusSchema,
      description:
        'Resume this thread’s goal once, after a wait, without changing whether automatic retry stays armed. Call only when the user asked for it: the goal resumes without further confirmation and spends tokens on later rounds.',
      tool: { name: 'goal_auto_retry_schedule', readOnly: false, render: renderJson },
    }),
    cancel: method({
      input: statusInput,
      output: retryStatusSchema,
      description: 'Drop this thread’s pending automatic goal retry and leave the goal paused. Call only when the user asked to cancel it.',
      tool: { name: 'goal_auto_retry_cancel', readOnly: false, render: renderJson },
    }),
  },
  events: {
    changed: event({
      schema: statusInput,
      description: 'A thread’s retry status changed: armed, scheduled, cancelled, resumed or given up. Read the status again.',
    }),
  },
})
