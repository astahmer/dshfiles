import { Schema } from 'effect'

const revisionEvidenceSchema = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/)))

const labelSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80), Schema.isPattern(/^[^\p{Cc}]+$/u))
const actionIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/))

const verificationReceiptSummarySchema = Schema.Struct({
  receiptId: Schema.String.check(Schema.isUUID()),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  actionId: actionIdSchema,
  label: labelSchema,
  status: Schema.Literals(['passed', 'failed', 'cancelled', 'timed-out']),
  failure: Schema.NullOr(
    Schema.Literals(['spawn-failed', 'process-group-failed', 'revision-unavailable', 'source-changed', 'remote-unavailable', 'remote-failed']),
  ),
  executor: Schema.optional(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('local') }),
      Schema.Struct({
        kind: Schema.Literal('remote'),
        remoteId: actionIdSchema,
        sshTarget: Schema.String.check(Schema.isMaxLength(255)),
        workspace: Schema.String.check(Schema.isMaxLength(2048)),
      }),
    ]),
  ),
  remoteFailure: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        remoteId: actionIdSchema,
        code: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)),
        message: Schema.String.check(Schema.isMaxLength(240)),
      }),
    ),
  ),
  startedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  finishedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  durationMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isInt())),
  automatic: Schema.Boolean,
  verificationTurn: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  attempt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
  sourceRevisionBefore: revisionEvidenceSchema,
  sourceRevisionAfter: revisionEvidenceSchema,
})
export type VerificationReceiptSummary = typeof verificationReceiptSummarySchema.Type

export const verificationReceiptEventSchema = Schema.Struct({
  kind: Schema.Literal('verification-receipt'),
  version: Schema.Literal(1),
  value: verificationReceiptSummarySchema,
})

export const activitySourceSchema = Schema.Literals(['session', 'communication', 'integration', 'workspace', 'system'])
export type ActivitySource = typeof activitySourceSchema.Type

export const activityLevelSchema = Schema.Literals(['routine', 'notable', 'attention'])
export type ActivityLevel = typeof activityLevelSchema.Type

const activityReferenceSchema = Schema.Struct({
  kind: Schema.Literals(['session', 'workspace', 'integration-candidate', 'message', 'revision']),
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
})
export type ActivityReference = typeof activityReferenceSchema.Type

const metadataValueSchema = Schema.Union([Schema.String.check(Schema.isMaxLength(500)), Schema.Number, Schema.Boolean, Schema.Null])
const eventIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const nullableIdSchema = (max: number) => Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max)))

const activityEventFields = {
  id: eventIdSchema,
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  source: activitySourceSchema,
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  level: activityLevelSchema,
  sessionId: nullableIdSchema(256),
  workspaceId: nullableIdSchema(256),
  taskId: nullableIdSchema(256),
  correlationId: nullableIdSchema(128),
  causationId: nullableIdSchema(256),
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
  metadata: Schema.Record(Schema.String, metadataValueSchema),
  references: Schema.Array(activityReferenceSchema).check(Schema.isMaxLength(8)),
  provenance: Schema.Literals(['observed', 'reported']),
}

export const activityEventSchema = Schema.Struct(activityEventFields)
export type ActivityEvent = typeof activityEventSchema.Type

export const activityIngestSchema = Schema.Struct({
  ...activityEventFields,
  level: Schema.optional(activityLevelSchema),
  sessionId: Schema.optional(nullableIdSchema(256)),
  workspaceId: Schema.optional(nullableIdSchema(256)),
  taskId: Schema.optional(nullableIdSchema(256)),
  correlationId: Schema.optional(nullableIdSchema(128)),
  causationId: Schema.optional(nullableIdSchema(256)),
  detail: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
  metadata: Schema.optional(Schema.Record(Schema.String, metadataValueSchema)),
  references: Schema.optional(Schema.Array(activityReferenceSchema).check(Schema.isMaxLength(8))),
  provenance: Schema.optional(Schema.Literals(['observed', 'reported'])),
})
export type ActivityIngest = typeof activityIngestSchema.Type

const condensedItemSchema = Schema.Struct({
  kind: Schema.Literals(['event', 'group']),
  id: eventIdSchema,
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  source: activitySourceSchema,
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  level: activityLevelSchema,
  sessionId: nullableIdSchema(256),
  correlationId: nullableIdSchema(128),
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  count: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  eventIds: Schema.Array(eventIdSchema).check(Schema.isMaxLength(500)),
  references: Schema.Array(activityReferenceSchema).check(Schema.isMaxLength(8)),
})
export type CondensedItem = typeof condensedItemSchema.Type

export const activityPageSchema = Schema.Struct({
  items: Schema.Array(condensedItemSchema).check(Schema.isMaxLength(200)),
  nextCursor: Schema.NullOr(eventIdSchema),
  hasMore: Schema.Boolean,
  newestAt: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  attentionCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  totalRetained: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type ActivityPage = typeof activityPageSchema.Type

const activityFilterSchema = Schema.Struct({
  sources: Schema.optional(Schema.Array(activitySourceSchema).check(Schema.isMaxLength(4))),
  levels: Schema.optional(Schema.Array(activityLevelSchema).check(Schema.isMaxLength(3))),
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  correlationId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  search: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  detailed: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))),
  before: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})
export type ActivityFilter = typeof activityFilterSchema.Type

export const activityStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  events: Schema.Array(activityEventSchema).check(Schema.isMaxLength(5000)),
  ingestCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  duplicateCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  startedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type ActivityState = typeof activityStateSchema.Type

/** The `backlog` payload of `dshfiles/activity/event`, as `@dshfiles/backlog` emits it. */
export const backlogActivitySchema = Schema.Struct({
  id: eventIdSchema,
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.Literals(['backlog.created', 'backlog.moved', 'backlog.linked', 'backlog.commented', 'backlog.attention', 'backlog.triaged']),
  level: activityLevelSchema,
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
  itemId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  sessionId: nullableIdSchema(256),
  revision: nullableIdSchema(256),
})
export type BacklogActivityInput = typeof backlogActivitySchema.Type
