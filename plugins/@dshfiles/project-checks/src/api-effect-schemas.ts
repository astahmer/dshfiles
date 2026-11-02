import * as Schema from 'effect/Schema'

/**
 * The Project Checks API contracts whose JSON Schema the Host publishes for its agent tools. Every schema here is an
 * Effect schema; `api.ts` wraps them for publication so the closed objects the previous contract produced survive.
 */

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const actionIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u))
const taskIdSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
const countSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const optionalSessionInputSchema = Schema.Struct({ sessionId: Schema.optionalKey(sessionIdSchema) })

export const actionsInputSchema = optionalSessionInputSchema
export const receiptsInputSchema = optionalSessionInputSchema
export const hookEventsInputSchema = optionalSessionInputSchema
export const tasksInputSchema = optionalSessionInputSchema

export const runInputSchema = Schema.Struct({ sessionId: Schema.optionalKey(sessionIdSchema), actionId: actionIdSchema })

export const cancelTaskInputSchema = Schema.Struct({ sessionId: Schema.optionalKey(sessionIdSchema), taskId: taskIdSchema })

export const retryTaskInputSchema = Schema.Struct({
  sessionId: Schema.optionalKey(sessionIdSchema),
  taskId: taskIdSchema,
  confirmPossibleDuplicate: Schema.Literal(true),
})

export const completionAuthorizationResultSchema = Schema.Struct({ status: Schema.Literals(['authorized', 'unavailable']) })

export const candidateVerificationResultSchema = Schema.Struct({
  status: Schema.Literals(['passed', 'failed', 'stale', 'cancelled', 'unavailable', 'attempt-limit']),
  prompt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
})

export const hookEventSchema = Schema.Struct({
  seq: countSchema,
  time: countSchema,
  kind: Schema.Literals(['invoked', 'result']),
  turn: countSchema,
  point: Schema.String.check(Schema.isMaxLength(120)),
  dialect: Schema.NullOr(Schema.Literals(['claude-code', 'codex'])),
  decision: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))),
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  durationMs: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  stderrPresent: Schema.Boolean,
})

export const hookEventsOutputSchema = Schema.Array(hookEventSchema).check(Schema.isMaxLength(12))

export type CandidateVerificationResult = Schema.Schema.Type<typeof candidateVerificationResultSchema>
export type ProjectHookEvent = Schema.Schema.Type<typeof hookEventSchema>
