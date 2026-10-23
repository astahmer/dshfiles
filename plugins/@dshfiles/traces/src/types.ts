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

export const traceStatsSchema = z
  .object({
    windowMinutes: z.number().int().positive(),
    spans: z.number().int().nonnegative(),
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

export const receiverStateSchema = z.enum(['starting', 'listening', 'port-in-use', 'disabled', 'failed'])
export type ReceiverState = z.infer<typeof receiverStateSchema>

export const viewerModeSchema = z.enum(['plugin', 'external', 'both'])
export type ViewerMode = z.infer<typeof viewerModeSchema>

const signalCountsSchema = z
  .object({ traces: z.number().int().nonnegative(), metrics: z.number().int().nonnegative(), logs: z.number().int().nonnegative() })
  .strict()

export const receiverStatusSchema = z
  .object({
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
        oldestMs: z.number().nullable(),
        newestMs: z.number().nullable(),
        retentionHours: z.number().int().positive(),
        retentionSpans: z.number().int().positive(),
        retentionLogs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
export type ReceiverStatus = z.infer<typeof receiverStatusSchema>
