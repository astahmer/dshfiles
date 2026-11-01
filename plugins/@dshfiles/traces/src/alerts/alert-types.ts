import * as Schema from 'effect/Schema'
import { TracesSchema } from '../schema.js'

export const ALERT_KINDS = ['error-rate', 'latency', 'throughput', 'span-count', 'duration'] as const
export const alertKindSchema = Schema.Literals(ALERT_KINDS)
export type AlertKind = Schema.Schema.Type<typeof alertKindSchema>

export const alertSeveritySchema = Schema.Literals(['info', 'warning', 'critical'])
export type AlertSeverity = Schema.Schema.Type<typeof alertSeveritySchema>

export const alertComparatorSchema = Schema.Literals(['above', 'below'])
export type AlertComparator = Schema.Schema.Type<typeof alertComparatorSchema>

const alertPercentileSchema = Schema.Literals([50, 90, 95, 99])

export const MAX_ALERT_RULES = 50
const MAX_ALERT_WINDOW_MINUTES = 24 * 60

const finiteNumber = Schema.Number.check(Schema.isFinite())
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const attributeKeySchema = Schema.String.check(Schema.isPattern(/^[\w.:/-]{1,128}$/))

/** Which spans a rule counts; every set field must match. */
export const spanFilterSchema = Schema.Struct({
  service: Schema.NullOr(TracesSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only spans of this service.name; null for any service.',
  }),
  operation: Schema.NullOr(TracesSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Span name: exact, or a prefix when it ends with * (e.g. "chat *", "jj *"); null for any span.',
  }),
  attribute: Schema.NullOr(
    Schema.Struct({
      key: attributeKeySchema.annotate({ description: 'Attribute key, e.g. gen_ai.provider.name.' }),
      value: Schema.String.check(Schema.isMaxLength(512)).annotate({ description: 'Exact value compared as text, or * for any value (the key is present).' }),
    }),
  ).annotate({ description: 'Only spans whose attribute has this value; null for no attribute filter.' }),
})
export type SpanFilter = Schema.Schema.Type<typeof spanFilterSchema>

export const alertRuleDraftSchema = Schema.Struct({
  id: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))).annotate({
    description: 'Existing rule id to update; omit to create a rule.',
  }),
  name: TracesSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  kind: alertKindSchema.annotate({
    description:
      'error-rate: share of matching spans that failed (threshold 0 to 1). latency: the percentile duration in ms. throughput: matching spans per minute. span-count: matching spans in the window. duration: any matching span longer than threshold ms.',
  }),
  filter: spanFilterSchema,
  windowMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(MAX_ALERT_WINDOW_MINUTES)).annotate({
    description: 'Spans that ended within this many minutes count.',
  }),
  threshold: finiteNumber.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1e12)),
  comparator: alertComparatorSchema.annotate({ description: 'Fire when the value is above or below the threshold; duration rules always fire above.' }),
  percentile: alertPercentileSchema.annotate({ description: 'Latency rules: which percentile; ignored by other kinds.' }),
  minSamples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100_000)).annotate({
    description: 'Error-rate and latency rules stay quiet with fewer matching spans than this, so one failure is not 100%.',
  }),
  severity: alertSeveritySchema,
  enabled: Schema.Boolean,
  notify: Schema.Boolean.annotate({ description: 'Show an in-app banner (and a browser notification when allowed) when the rule fires.' }),
  markThreads: Schema.Boolean.annotate({ description: 'Mark the threads whose spans tripped the rule (dsh.session.id) unread in the thread sidebar.' }),
}).check(
  Schema.makeFilter(draft => {
    if (draft.kind !== 'error-rate' || draft.threshold <= 1) return undefined
    return { path: ['threshold'], issue: 'An error-rate threshold is a share between 0 and 1.' }
  }),
)
export type AlertRuleDraft = Schema.Schema.Type<typeof alertRuleDraftSchema>

export const alertRuleSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: alertKindSchema,
  filter: spanFilterSchema,
  windowMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
  threshold: finiteNumber,
  comparator: alertComparatorSchema,
  percentile: alertPercentileSchema,
  minSamples: Schema.Int.check(Schema.isGreaterThan(0)),
  severity: alertSeveritySchema,
  enabled: Schema.Boolean,
  notify: Schema.Boolean,
  markThreads: Schema.Boolean,
  mutedUntil: Schema.NullOr(finiteNumber).annotate({ description: 'While set and in the future, the rule still evaluates but delivers nothing.' }),
  builtin: Schema.Boolean.annotate({ description: 'Shipped with the plugin; editable and removable like any rule.' }),
  createdAt: finiteNumber,
  updatedAt: finiteNumber,
})
export type AlertRule = Schema.Schema.Type<typeof alertRuleSchema>

const alertStatusSchema = Schema.Literals(['ok', 'firing'])
export type AlertStatus = Schema.Schema.Type<typeof alertStatusSchema>

export const alertStateSchema = Schema.Struct({
  status: alertStatusSchema,
  since: Schema.NullOr(finiteNumber).annotate({ description: 'When the current firing started; null while ok.' }),
  value: Schema.NullOr(finiteNumber).annotate({ description: 'The last evaluated value; null when no span matched.' }),
  sampleCount: nonNegativeInt,
  evaluatedAt: Schema.NullOr(finiteNumber),
  clearEvaluations: nonNegativeInt.annotate({ description: 'Consecutive evaluations under the threshold while firing.' }),
})
export type AlertState = Schema.Schema.Type<typeof alertStateSchema>

export const alertEventPayloadSchema = Schema.Struct({
  ruleId: Schema.String,
  ruleName: Schema.String,
  severity: alertSeveritySchema,
  kind: Schema.Literals(['firing', 'resolved']),
  reason: Schema.Literals(['threshold', 'disabled', 'removed']),
  at: finiteNumber,
  value: Schema.NullOr(finiteNumber),
  threshold: finiteNumber,
  sampleCount: nonNegativeInt,
  sessionIds: Schema.Array(Schema.String).annotate({ description: 'Threads (dsh.session.id) whose spans tripped the rule, at most 10.' }),
  sampleTraceId: Schema.NullOr(Schema.String),
  muted: Schema.Boolean,
  notify: Schema.Boolean.annotate({ description: 'Whether clients should announce this event.' }),
  threadsMarked: nonNegativeInt,
  deliveryError: Schema.NullOr(Schema.String),
})

export const alertEventSchema = Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0)), ...alertEventPayloadSchema.fields })
export type AlertEvent = Schema.Schema.Type<typeof alertEventSchema>

const alertRuleViewSchema = Schema.Struct({ ...alertRuleSchema.fields, state: alertStateSchema })
export type AlertRuleView = Schema.Schema.Type<typeof alertRuleViewSchema>

export const alertsSnapshotSchema = Schema.Struct({
  rules: Schema.Array(alertRuleViewSchema),
  firing: nonNegativeInt,
  history: Schema.Array(alertEventSchema),
  latestEventId: nonNegativeInt,
  lastEvaluatedAt: Schema.NullOr(finiteNumber),
  intervalSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
})
export type AlertsSnapshot = Schema.Schema.Type<typeof alertsSnapshotSchema>

export const alertFeedSchema = Schema.Struct({
  latestEventId: nonNegativeInt,
  firing: nonNegativeInt,
  events: Schema.Array(alertEventSchema),
})
export type AlertFeed = Schema.Schema.Type<typeof alertFeedSchema>

export const evaluationSummarySchema = Schema.Struct({
  evaluatedAt: finiteNumber,
  evaluated: nonNegativeInt,
  transitions: nonNegativeInt,
  firing: nonNegativeInt,
})
export type EvaluationSummary = Schema.Schema.Type<typeof evaluationSummarySchema>
