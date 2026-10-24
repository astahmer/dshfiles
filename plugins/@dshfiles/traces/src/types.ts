import { z } from 'zod'

export const attributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number()), z.array(z.boolean())])
export type AttributeValue = z.infer<typeof attributeValueSchema>

const attributesSchema = z.record(z.string(), attributeValueSchema)

export const spanStatusSchema = z.enum(['unset', 'ok', 'error'])
export type SpanStatus = z.infer<typeof spanStatusSchema>

export const spanKindSchema = z.enum(['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'])
export type SpanKind = z.infer<typeof spanKindSchema>

export const traceSummarySchema = z
  .object({
    traceId: z.string(),
    rootName: z.string(),
    rootService: z.string(),
    startMs: z.number(),
    durationMs: z.number().nonnegative(),
    spanCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    services: z.array(z.string()),
    sessionId: z.string().nullable(),
    costUsd: z.number().nonnegative().nullable().describe('Sum of dshx.cost.usd (list price) over its model-call spans; null when none is priced.'),
  })
  .strict()
export type TraceSummary = z.infer<typeof traceSummarySchema>

export const traceListSchema = z.object({ traces: z.array(traceSummarySchema), nextCursor: z.string().nullable() }).strict()
export type TraceList = z.infer<typeof traceListSchema>

export const spanEventSchema = z.object({ name: z.string(), offsetMs: z.number(), attributes: attributesSchema }).strict()

export const spanRowSchema = z
  .object({
    spanId: z.string(),
    parentSpanId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    childCount: z.number().int().nonnegative(),
    name: z.string(),
    service: z.string(),
    scope: z.string().nullable(),
    kind: spanKindSchema,
    offsetMs: z.number(),
    durationMs: z.number().nonnegative(),
    status: spanStatusSchema,
    statusMessage: z.string().nullable(),
    sessionId: z.string().nullable(),
    attributes: attributesSchema,
    resource: attributesSchema,
    events: z.array(spanEventSchema),
    linkCount: z.number().int().nonnegative(),
  })
  .strict()
export type SpanRow = z.infer<typeof spanRowSchema>

export const traceDetailSchema = z
  .object({
    traceId: z.string(),
    startMs: z.number(),
    durationMs: z.number().nonnegative(),
    spans: z.array(spanRowSchema),
  })
  .strict()
export type TraceDetail = z.infer<typeof traceDetailSchema>

export const latencySchema = z
  .object({
    count: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
    p99Ms: z.number().nullable(),
    maxMs: z.number().nullable(),
  })
  .strict()
export type Latency = z.infer<typeof latencySchema>

export const operationStatsSchema = latencySchema.extend({ service: z.string(), name: z.string() }).strict()
export type OperationStats = z.infer<typeof operationStatsSchema>

export const serviceStatsSchema = latencySchema.extend({ service: z.string() }).strict()

export const modelUsageSchema = z
  .object({
    service: z.string(),
    provider: z.string().nullable(),
    model: z.string(),
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative().nullable().describe('Sum of dshx.cost.usd (list price); null when no call is priced.'),
  })
  .strict()
export type ModelUsage = z.infer<typeof modelUsageSchema>

export const traceStatsSchema = z
  .object({
    windowMinutes: z.number().int().positive(),
    spans: z.number().int().nonnegative(),
    models: z.array(modelUsageSchema).describe('Model-call spans per service and model, most expensive first (at most 50).'),
    services: z.array(serviceStatsSchema),
    operations: z.array(operationStatsSchema),
  })
  .strict()
export type TraceStats = z.infer<typeof traceStatsSchema>

export const serviceEdgeSchema = latencySchema.extend({ source: z.string(), target: z.string() }).strict()
export type ServiceEdge = z.infer<typeof serviceEdgeSchema>

export const serviceMapSchema = z
  .object({
    windowMinutes: z.number().int().positive(),
    nodes: z.array(serviceStatsSchema),
    edges: z.array(serviceEdgeSchema),
  })
  .strict()
export type ServiceMap = z.infer<typeof serviceMapSchema>

const tokenTotalsSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative(),
  })
  .strict()

export const sessionSummarySchema = z
  .object({
    sessionId: z.string(),
    traces: z.number().int().nonnegative(),
    spans: z.number().int().nonnegative(),
    errorSpans: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative().describe('invoke_agent spans (gen_ai.operation.name).'),
    modelCalls: z.number().int().nonnegative().describe('chat spans: one per LLM attempt, retries included.'),
    toolCalls: z.number().int().nonnegative().describe('execute_tool spans.'),
    firstMs: z.number().nullable(),
    lastMs: z.number().nullable(),
    totalTraceMs: z.number().nonnegative().describe('Sum of the trace durations.'),
    traceLatency: latencySchema.describe('Per-trace duration percentiles; errorCount counts traces with an error span.'),
    modelLatency: latencySchema.describe('Per model-call duration percentiles.'),
    tokens: tokenTotalsSchema.nullable().describe('Sums of gen_ai.usage.* over model-call spans; null when none carries usage.'),
    costUsd: z
      .number()
      .nonnegative()
      .nullable()
      .describe('List-price USD: sum of dshx.cost.usd over model-call spans (subagent calls in its traces included); null when none is priced.'),
    turnCosts: z
      .array(z.object({ turn: z.number().int().nonnegative(), costUsd: z.number().nonnegative(), modelCalls: z.number().int().nonnegative() }).strict())
      .describe("This thread's own priced turns (dsh.turn), oldest first, at most the last 500."),
    services: z.array(z.string()),
  })
  .strict()
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const errorGroupSchema = z
  .object({
    service: z.string(),
    name: z.string(),
    errorType: z.string().nullable(),
    message: z.string().nullable(),
    count: z.number().int().positive(),
    firstSeenMs: z.number(),
    lastSeenMs: z.number(),
    sampleTraceId: z.string(),
    sampleSpanId: z.string(),
  })
  .strict()
export type ErrorGroup = z.infer<typeof errorGroupSchema>

export const logRecordSchema = z
  .object({
    id: z.number().int(),
    timeMs: z.number(),
    severityNumber: z.number().int().min(0).max(24),
    severityText: z.string().nullable(),
    body: z.string(),
    service: z.string(),
    scope: z.string().nullable(),
    traceId: z.string().nullable(),
    spanId: z.string().nullable(),
    eventName: z.string().nullable(),
    attributes: attributesSchema,
    resource: attributesSchema,
  })
  .strict()
export type LogRecord = z.infer<typeof logRecordSchema>

export const logListSchema = z.object({ logs: z.array(logRecordSchema), nextCursor: z.string().nullable() }).strict()
export type LogList = z.infer<typeof logListSchema>

export const metricTypeSchema = z.enum(['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'])

export const metricSummarySchema = z
  .object({
    service: z.string(),
    name: z.string(),
    type: metricTypeSchema,
    unit: z.string().nullable(),
    description: z.string().nullable(),
    points: z.number().int().nonnegative(),
    series: z.number().int().nonnegative(),
    lastMs: z.number(),
    lastValue: z.number().nullable(),
  })
  .strict()
export type MetricSummary = z.infer<typeof metricSummarySchema>

export const metricSeriesSchema = z
  .object({
    service: z.string(),
    name: z.string(),
    type: metricTypeSchema,
    unit: z.string().nullable(),
    description: z.string().nullable(),
    valueKind: z.enum(['value', 'increase', 'mean']),
    series: z.array(
      z
        .object({
          attributes: attributesSchema,
          points: z.array(z.object({ timeMs: z.number(), value: z.number() }).strict()),
        })
        .strict(),
    ),
    truncatedSeries: z.number().int().nonnegative(),
  })
  .strict()
export type MetricSeries = z.infer<typeof metricSeriesSchema>

export const receiverStateSchema = z.enum(['starting', 'listening', 'port-in-use', 'disabled', 'failed'])
export type ReceiverState = z.infer<typeof receiverStateSchema>

export const viewerModeSchema = z.enum(['plugin', 'external', 'both'])
export type ViewerMode = z.infer<typeof viewerModeSchema>

const signalCountsSchema = z
  .object({ traces: z.number().int().nonnegative(), metrics: z.number().int().nonnegative(), logs: z.number().int().nonnegative() })
  .strict()

const exportTargetSchema = z
  .object({
    source: z.enum(['environment', 'local-receiver', 'off']),
    url: z.string().nullable(),
  })
  .strict()

export const diagnosisCodeSchema = z.enum(['receiving', 'waiting', 'exporting-elsewhere', 'no-exporter', 'external-mode', 'port-in-use', 'failed', 'starting'])
export type DiagnosisCode = z.infer<typeof diagnosisCodeSchema>

export const diagnosisSchema = z.object({ code: diagnosisCodeSchema, message: z.string() }).strict()
export type Diagnosis = z.infer<typeof diagnosisSchema>

export const exportersSchema = z
  .object({
    traces: exportTargetSchema.describe("Where this Host process's dshx spans go now."),
    metrics: exportTargetSchema.describe("Where this Host process's usage metrics push goes now."),
    environmentPointsHere: z.boolean().nullable().describe('Whether OTEL_EXPORTER_OTLP_ENDPOINT targets this receiver; null when unset.'),
  })
  .strict()
export type Exporters = z.infer<typeof exportersSchema>

export const receiverStatusSchema = z
  .object({
    diagnosis: diagnosisSchema.optional().describe('Why telemetry does or does not arrive; absent on a Host older than this field.'),
    exporters: exportersSchema.optional(),
    mode: viewerModeSchema,
    externalViewerUrl: z.string().nullable(),
    state: receiverStateSchema,
    address: z.string(),
    configuredPort: z.number().int().nonnegative(),
    boundPort: z.number().int().nonnegative().nullable(),
    message: z.string().nullable(),
    startedAt: z.number().nullable(),
    requests: signalCountsSchema,
    accepted: signalCountsSchema,
    rejectedRequests: z.number().int().nonnegative(),
    rejectedItems: z.number().int().nonnegative(),
    lastReceivedAt: z.number().nullable(),
    forward: z
      .object({
        url: z.string().nullable(),
        forwarded: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
        lastError: z.string().nullable(),
      })
      .strict(),
    store: z
      .object({
        spans: z.number().int().nonnegative(),
        traces: z.number().int().nonnegative(),
        logs: z.number().int().nonnegative(),
        metricPoints: z.number().int().nonnegative(),
        oldestMs: z.number().nullable(),
        newestMs: z.number().nullable(),
        retentionHours: z.number().int().positive(),
        retentionSpans: z.number().int().positive(),
        retentionLogs: z.number().int().positive(),
        retentionMetricPoints: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
export type ReceiverStatus = z.infer<typeof receiverStatusSchema>
