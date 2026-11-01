import * as Schema from 'effect/Schema'

export const attributeValueSchema = Schema.Union([
  Schema.String,
  Schema.Number.check(Schema.isFinite()),
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Array(Schema.Number.check(Schema.isFinite())),
  Schema.Array(Schema.Boolean),
])
export type AttributeValue = Schema.Schema.Type<typeof attributeValueSchema>

const attributesSchema = Schema.Record(Schema.String, attributeValueSchema)

const spanStatusSchema = Schema.Literals(['unset', 'ok', 'error'])
export type SpanStatus = Schema.Schema.Type<typeof spanStatusSchema>

const spanKindSchema = Schema.Literals(['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'])
export type SpanKind = Schema.Schema.Type<typeof spanKindSchema>

const traceSummarySchema = Schema.Struct({
  traceId: Schema.String,
  rootName: Schema.String,
  rootService: Schema.String,
  startMs: Schema.Number.check(Schema.isFinite()),
  durationMs: Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0)),
  spanCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  errorCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  services: Schema.Array(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  costUsd: Schema.NullOr(Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: 'Sum of dshx.cost.usd (list price) over its model-call spans; null when none is priced.',
  }),
})
export type TraceSummary = Schema.Schema.Type<typeof traceSummarySchema>

export const traceListSchema = Schema.Struct({ traces: Schema.Array(traceSummarySchema), nextCursor: Schema.NullOr(Schema.String) })
export type TraceList = Schema.Schema.Type<typeof traceListSchema>

const spanEventSchema = Schema.Struct({
  name: Schema.String,
  offsetMs: Schema.Number.check(Schema.isFinite()),
  attributes: attributesSchema,
})

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const finiteNumber = Schema.Number.check(Schema.isFinite())
const nonNegativeNumber = finiteNumber.check(Schema.isGreaterThanOrEqualTo(0))

const spanRowSchema = Schema.Struct({
  spanId: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  depth: nonNegativeInt,
  childCount: nonNegativeInt,
  name: Schema.String,
  service: Schema.String,
  scope: Schema.NullOr(Schema.String),
  kind: spanKindSchema,
  offsetMs: finiteNumber,
  durationMs: nonNegativeNumber,
  status: spanStatusSchema,
  statusMessage: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  attributes: attributesSchema,
  resource: attributesSchema,
  events: Schema.Array(spanEventSchema),
  linkCount: nonNegativeInt,
})
export type SpanRow = Schema.Schema.Type<typeof spanRowSchema>

export const traceDetailSchema = Schema.Struct({
  traceId: Schema.String,
  startMs: finiteNumber,
  durationMs: nonNegativeNumber,
  spans: Schema.Array(spanRowSchema),
})
export type TraceDetail = Schema.Schema.Type<typeof traceDetailSchema>

const latencyFields = {
  count: nonNegativeInt,
  errorCount: nonNegativeInt,
  errorRate: finiteNumber.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  p50Ms: Schema.NullOr(finiteNumber),
  p95Ms: Schema.NullOr(finiteNumber),
  p99Ms: Schema.NullOr(finiteNumber),
  maxMs: Schema.NullOr(finiteNumber),
} as const satisfies Schema.Struct.Fields

const latencySchema = Schema.Struct(latencyFields)
export type Latency = Schema.Schema.Type<typeof latencySchema>

const operationStatsSchema = Schema.Struct({ ...latencyFields, service: Schema.String, name: Schema.String })
export type OperationStats = Schema.Schema.Type<typeof operationStatsSchema>

const serviceStatsSchema = Schema.Struct({ ...latencyFields, service: Schema.String })

const modelUsageSchema = Schema.Struct({
  service: Schema.String,
  provider: Schema.NullOr(Schema.String),
  model: Schema.String,
  calls: nonNegativeInt,
  inputTokens: nonNegativeNumber,
  outputTokens: nonNegativeNumber,
  costUsd: Schema.NullOr(nonNegativeNumber).annotate({ description: 'Sum of dshx.cost.usd (list price); null when no call is priced.' }),
})
export type ModelUsage = Schema.Schema.Type<typeof modelUsageSchema>

export const traceStatsSchema = Schema.Struct({
  windowMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
  spans: nonNegativeInt,
  models: Schema.Array(modelUsageSchema).annotate({ description: 'Model-call spans per service and model, most expensive first (at most 50).' }),
  services: Schema.Array(serviceStatsSchema),
  operations: Schema.Array(operationStatsSchema),
})
export type TraceStats = Schema.Schema.Type<typeof traceStatsSchema>

const serviceEdgeSchema = Schema.Struct({ ...latencyFields, source: Schema.String, target: Schema.String })
export type ServiceEdge = Schema.Schema.Type<typeof serviceEdgeSchema>

export const serviceMapSchema = Schema.Struct({
  windowMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
  nodes: Schema.Array(serviceStatsSchema),
  edges: Schema.Array(serviceEdgeSchema),
})
export type ServiceMap = Schema.Schema.Type<typeof serviceMapSchema>

const tokenTotalsSchema = Schema.Struct({
  input: nonNegativeInt,
  output: nonNegativeInt,
  cacheRead: nonNegativeInt,
  reasoning: nonNegativeInt,
})

export const sessionSummarySchema = Schema.Struct({
  sessionId: Schema.String,
  traces: nonNegativeInt,
  spans: nonNegativeInt,
  errorSpans: nonNegativeInt,
  turns: nonNegativeInt.annotate({ description: 'invoke_agent spans (gen_ai.operation.name).' }),
  modelCalls: nonNegativeInt.annotate({ description: 'chat spans: one per LLM attempt, retries included.' }),
  toolCalls: nonNegativeInt.annotate({ description: 'execute_tool spans.' }),
  firstMs: Schema.NullOr(finiteNumber),
  lastMs: Schema.NullOr(finiteNumber),
  totalTraceMs: nonNegativeNumber.annotate({ description: 'Sum of the trace durations.' }),
  traceLatency: latencySchema.annotate({ description: 'Per-trace duration percentiles; errorCount counts traces with an error span.' }),
  modelLatency: latencySchema.annotate({ description: 'Per model-call duration percentiles.' }),
  tokens: Schema.NullOr(tokenTotalsSchema).annotate({ description: 'Sums of gen_ai.usage.* over model-call spans; null when none carries usage.' }),
  costUsd: Schema.NullOr(nonNegativeNumber).annotate({
    description: 'List-price USD: sum of dshx.cost.usd over model-call spans (subagent calls in its traces included); null when none is priced.',
  }),
  turnCosts: Schema.Array(Schema.Struct({ turn: nonNegativeInt, costUsd: nonNegativeNumber, modelCalls: nonNegativeInt })).annotate({
    description: "This thread's own priced turns (dsh.turn), oldest first, at most the last 500.",
  }),
  services: Schema.Array(Schema.String),
})
export type SessionSummary = Schema.Schema.Type<typeof sessionSummarySchema>

export const errorGroupSchema = Schema.Struct({
  service: Schema.String,
  name: Schema.String,
  errorType: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  count: Schema.Int.check(Schema.isGreaterThan(0)),
  firstSeenMs: finiteNumber,
  lastSeenMs: finiteNumber,
  sampleTraceId: Schema.String,
  sampleSpanId: Schema.String,
})
export type ErrorGroup = Schema.Schema.Type<typeof errorGroupSchema>

const logRecordSchema = Schema.Struct({
  id: Schema.Int,
  timeMs: finiteNumber,
  severityNumber: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(24)),
  severityText: Schema.NullOr(Schema.String),
  body: Schema.String,
  service: Schema.String,
  scope: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
  spanId: Schema.NullOr(Schema.String),
  eventName: Schema.NullOr(Schema.String),
  attributes: attributesSchema,
  resource: attributesSchema,
})
export type LogRecord = Schema.Schema.Type<typeof logRecordSchema>

export const logListSchema = Schema.Struct({ logs: Schema.Array(logRecordSchema), nextCursor: Schema.NullOr(Schema.String) })
export type LogList = Schema.Schema.Type<typeof logListSchema>

const metricTypeSchema = Schema.Literals(['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'])

export const metricSummarySchema = Schema.Struct({
  service: Schema.String,
  name: Schema.String,
  type: metricTypeSchema,
  unit: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  points: nonNegativeInt,
  series: nonNegativeInt,
  lastMs: finiteNumber,
  lastValue: Schema.NullOr(finiteNumber),
})
export type MetricSummary = Schema.Schema.Type<typeof metricSummarySchema>

export const metricSeriesSchema = Schema.Struct({
  service: Schema.String,
  name: Schema.String,
  type: metricTypeSchema,
  unit: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  valueKind: Schema.Literals(['value', 'increase', 'mean']),
  series: Schema.Array(
    Schema.Struct({
      attributes: attributesSchema,
      points: Schema.Array(Schema.Struct({ timeMs: finiteNumber, value: finiteNumber })),
    }),
  ),
  truncatedSeries: nonNegativeInt,
})
export type MetricSeries = Schema.Schema.Type<typeof metricSeriesSchema>

const receiverStateSchema = Schema.Literals(['starting', 'listening', 'port-in-use', 'disabled', 'failed'])
export type ReceiverState = Schema.Schema.Type<typeof receiverStateSchema>

const viewerModeSchema = Schema.Literals(['plugin', 'external', 'both'])
export type ViewerMode = Schema.Schema.Type<typeof viewerModeSchema>

const signalCountsSchema = Schema.Struct({ traces: nonNegativeInt, metrics: nonNegativeInt, logs: nonNegativeInt })

const exportTargetSchema = Schema.Struct({ source: Schema.Literals(['environment', 'local-receiver', 'off']), url: Schema.NullOr(Schema.String) })

const diagnosisCodeSchema = Schema.Literals([
  'receiving',
  'waiting',
  'exporting-elsewhere',
  'no-exporter',
  'external-mode',
  'port-in-use',
  'failed',
  'starting',
])
export type DiagnosisCode = Schema.Schema.Type<typeof diagnosisCodeSchema>

const diagnosisSchema = Schema.Struct({ code: diagnosisCodeSchema, message: Schema.String })
export type Diagnosis = Schema.Schema.Type<typeof diagnosisSchema>

const exportersSchema = Schema.Struct({
  traces: exportTargetSchema.annotate({ description: "Where this Host process's dshx spans go now." }),
  metrics: exportTargetSchema.annotate({ description: "Where this Host process's usage metrics push goes now." }),
  environmentPointsHere: Schema.NullOr(Schema.Boolean).annotate({ description: 'Whether OTEL_EXPORTER_OTLP_ENDPOINT targets this receiver; null when unset.' }),
})
export type Exporters = Schema.Schema.Type<typeof exportersSchema>

const positiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const receiverStatusSchema = Schema.Struct({
  diagnosis: Schema.optionalKey(diagnosisSchema).annotate({ description: 'Why telemetry does or does not arrive; absent on a Host older than this field.' }),
  exporters: Schema.optionalKey(exportersSchema),
  mode: viewerModeSchema,
  externalViewerUrl: Schema.NullOr(Schema.String),
  state: receiverStateSchema,
  address: Schema.String,
  configuredPort: nonNegativeInt,
  boundPort: Schema.NullOr(nonNegativeInt),
  message: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(finiteNumber),
  requests: signalCountsSchema,
  accepted: signalCountsSchema,
  rejectedRequests: nonNegativeInt,
  rejectedItems: nonNegativeInt,
  lastReceivedAt: Schema.NullOr(finiteNumber),
  forward: Schema.Struct({ url: Schema.NullOr(Schema.String), forwarded: nonNegativeInt, failures: nonNegativeInt, lastError: Schema.NullOr(Schema.String) }),
  store: Schema.Struct({
    spans: nonNegativeInt,
    traces: nonNegativeInt,
    logs: nonNegativeInt,
    metricPoints: nonNegativeInt,
    oldestMs: Schema.NullOr(finiteNumber),
    newestMs: Schema.NullOr(finiteNumber),
    retentionHours: positiveInt,
    retentionSpans: positiveInt,
    retentionLogs: positiveInt,
    retentionMetricPoints: positiveInt,
  }),
})
export type ReceiverStatus = Schema.Schema.Type<typeof receiverStatusSchema>
