import { Effect, Option, Schema } from 'effect'
import { receiptExecutorSchema, receiptRemoteFailureSchema } from './api.js'
import type { StoredReceipt } from './store.js'

const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const revisionSchema = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/u)))

const projectChecksActivitySummarySchema = Schema.Struct({
  receiptId: Schema.String.check(Schema.isUUID()),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  actionId: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80), Schema.isPattern(/^[^\p{Cc}]+$/u)),
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
  automatic: Schema.Boolean,
  verificationTurn: Schema.NullOr(countInt),
  attempt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
  sourceRevisionBefore: revisionSchema,
  sourceRevisionAfter: revisionSchema,
})

export const projectChecksActivityEventSchema = Schema.Struct({
  kind: Schema.Literal('verification-receipt'),
  version: Schema.Literal(1),
  value: projectChecksActivitySummarySchema,
})

export type ProjectChecksActivityEvent = typeof projectChecksActivityEventSchema.Type

const activityEventInput = (receipt: StoredReceipt) => {
  const summaryExtras: { -readonly [Key in keyof ProjectChecksActivityEvent['value']]?: ProjectChecksActivityEvent['value'][Key] } = {}
  if (receipt.executor !== undefined) summaryExtras.executor = receipt.executor
  if (receipt.remoteFailure !== undefined) summaryExtras.remoteFailure = receipt.remoteFailure
  return {
    kind: 'verification-receipt',
    version: 1,
    value: {
      receiptId: receipt.id,
      sessionId: receipt.sessionId,
      actionId: receipt.actionId,
      label:
        receipt.label
          .replace(/\p{Cc}/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80) || receipt.actionId,
      status: receipt.status,
      failure: receipt.failure,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      durationMs: receipt.durationMs,
      exitCode: receipt.exitCode,
      automatic: receipt.automatic,
      verificationTurn: receipt.verificationTurn,
      attempt: receipt.attempt,
      sourceRevisionBefore: receipt.sourceRevisionBefore ?? null,
      sourceRevisionAfter: receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter,
      ...summaryExtras,
    },
  }
}

const projectChecksActivityEvent = (receipt: StoredReceipt): ProjectChecksActivityEvent =>
  Schema.decodeUnknownSync(projectChecksActivityEventSchema)(activityEventInput(receipt))

const activityEventOf = (receipt: StoredReceipt): Option.Option<ProjectChecksActivityEvent> =>
  Schema.decodeUnknownOption(projectChecksActivityEventSchema)(activityEventInput(receipt))

/** Publish a receipt only after it is durable; a receipt the timeline cannot summarize is not published. */
const persistReceiptAndEmitActivity = <E, R>(input: {
  readonly receipt: StoredReceipt
  readonly persist: Effect.Effect<void, E, R>
  readonly emit: (event: ProjectChecksActivityEvent) => Effect.Effect<void>
}): Effect.Effect<void, E, R> => Effect.andThen(input.persist, publishActivity(input))

const publishActivity = (input: { readonly receipt: StoredReceipt; readonly emit: (event: ProjectChecksActivityEvent) => Effect.Effect<void> }) =>
  Effect.suspend(() => Option.match(activityEventOf(input.receipt), { onNone: () => Effect.void, onSome: input.emit }))

export class ProjectChecksActivityModel {
  static readonly event = projectChecksActivityEvent
  static readonly publish = publishActivity
  static readonly persistAndEmit = persistReceiptAndEmitActivity
}
