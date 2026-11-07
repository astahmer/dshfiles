import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'

const quotaContinuationStateSchema = Schema.Literals(['waiting', 'queued', 'invalidated', 'completed'])

const safeNonNegativeInteger = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

const routeText = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

export const quotaContinuationRecordSchema = Schema.Struct({
  continuationId: Schema.String.check(Schema.isUUID()),
  sessionId: AiAccountsSchema.trimmedName(256),
  accountId: AiAccountsSchema.trimmedName(64),
  failedProvider: Schema.optional(routeText(200)),
  failedModel: Schema.optional(routeText(200)),
  failedSeq: safeNonNegativeInteger,
  failedAt: safeNonNegativeInteger,
  resetAt: Schema.NullOr(safeNonNegativeInteger),
  /** When an unknown-reset recovery retries next; `null` for a known reset, which waits for `resetAt` instead. */
  retryAt: Schema.NullOr(safeNonNegativeInteger).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** How many backoff rungs this thread already spent, so a repeat failure waits longer than the first one. */
  retryAttempt: safeNonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  autoRetry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** `user` once someone ticked or unticked this recovery, so its choice carries to the thread's next failure. */
  autoRetrySource: Schema.optional(Schema.Literals(['user', 'default'])),
  snoozedUntil: Schema.NullOr(safeNonNegativeInteger),
  scheduleId: Schema.NullOr(AiAccountsSchema.trimmedName(128)),
  queueSource: Schema.NullOr(Schema.Literals(['manual', 'schedule'])),
  state: quotaContinuationStateSchema,
})

export type QuotaContinuationRecord = typeof quotaContinuationRecordSchema.Type

export const quotaContinuationSummarySchema = Schema.Struct({
  continuationId: Schema.String.check(Schema.isUUID()),
  sessionId: AiAccountsSchema.trimmedName(256),
  accountId: AiAccountsSchema.trimmedName(64),
  title: Schema.optional(AiAccountsSchema.trimmedName(512)),
  cwd: Schema.optional(AiAccountsSchema.trimmedName(4096)),
  failedProvider: Schema.optional(routeText(200)),
  failedModel: Schema.optional(routeText(200)),
  failedAt: safeNonNegativeInteger,
  resetAt: Schema.NullOr(safeNonNegativeInteger),
  retryAt: Schema.NullOr(safeNonNegativeInteger).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  retryAttempt: safeNonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  autoRetry: Schema.Boolean.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(false))),
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
  snoozedUntil: Schema.NullOr(safeNonNegativeInteger),
  state: Schema.Literals(['waiting', 'queued']),
  scheduled: Schema.Boolean,
  ready: Schema.Boolean,
})

export type QuotaContinuationSummary = typeof quotaContinuationSummarySchema.Type
