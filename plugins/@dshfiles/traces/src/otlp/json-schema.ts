import { z } from 'zod'

/**
 * The OTLP/HTTP JSON mapping of `ExportTraceServiceRequest`
 * (https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding). The protobuf decoder emits the same shape, so
 * both wire formats cross this one schema before anything is stored.
 */

const MAX_ANY_VALUE_DEPTH = 8

const int64Schema = z.union([z.string().regex(/^-?\d{1,20}$/), z.number().int()])
const unixNanoSchema = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()])

export type OtlpAnyValue = {
  readonly stringValue?: string | undefined
  readonly boolValue?: boolean | undefined
  readonly intValue?: string | number | undefined
  readonly doubleValue?: number | string | undefined
  readonly bytesValue?: string | undefined
  readonly arrayValue?: { readonly values?: readonly OtlpAnyValue[] | undefined } | undefined
  readonly kvlistValue?: { readonly values?: readonly OtlpKeyValue[] | undefined } | undefined
}

export type OtlpKeyValue = { readonly key: string; readonly value?: OtlpAnyValue | undefined }

const anyValueAt = (depth: number): z.ZodType<OtlpAnyValue> =>
  z.lazy(() =>
    depth >= MAX_ANY_VALUE_DEPTH
      ? z.object({}).loose()
      : z
          .object({
            stringValue: z.string().optional(),
            boolValue: z.boolean().optional(),
            intValue: int64Schema.optional(),
            doubleValue: z.union([z.number(), z.enum(['NaN', 'Infinity', '-Infinity'])]).optional(),
            bytesValue: z.string().optional(),
            arrayValue: z.object({ values: z.array(anyValueAt(depth + 1)).optional() }).optional(),
            kvlistValue: z.object({ values: z.array(keyValueAt(depth + 1)).optional() }).optional(),
          })
          .loose(),
  )

const keyValueAt = (depth: number): z.ZodType<OtlpKeyValue> => z.lazy(() => z.object({ key: z.string(), value: anyValueAt(depth).optional() }).loose())

const attributesSchema = z.array(keyValueAt(0)).optional()

const otlpEventSchema = z
  .object({
    timeUnixNano: unixNanoSchema.optional(),
    name: z.string().optional(),
    attributes: attributesSchema,
  })
  .loose()

const SPAN_KIND_NUMBERS = new Map([
  ['SPAN_KIND_UNSPECIFIED', 0],
  ['SPAN_KIND_INTERNAL', 1],
  ['SPAN_KIND_SERVER', 2],
  ['SPAN_KIND_CLIENT', 3],
  ['SPAN_KIND_PRODUCER', 4],
  ['SPAN_KIND_CONSUMER', 5],
])

const STATUS_CODE_NUMBERS = new Map([
  ['STATUS_CODE_UNSET', 0],
  ['STATUS_CODE_OK', 1],
  ['STATUS_CODE_ERROR', 2],
])

const SEVERITY_NUMBERS = new Map([
  ['SEVERITY_NUMBER_UNSPECIFIED', 0],
  ['SEVERITY_NUMBER_TRACE', 1],
  ['SEVERITY_NUMBER_DEBUG', 5],
  ['SEVERITY_NUMBER_INFO', 9],
  ['SEVERITY_NUMBER_WARN', 13],
  ['SEVERITY_NUMBER_ERROR', 17],
  ['SEVERITY_NUMBER_FATAL', 21],
])

/** OTLP/JSON may spell an enum by its name; decoding settles it to the number the protobuf wire carries. */
const enumNumberSchema = (numbers: ReadonlyMap<string, number>) => z.union([z.number().int(), z.string().transform(name => numbers.get(name) ?? 0)])

const otlpSpanSchema = z
  .object({
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    name: z.string().optional(),
    kind: enumNumberSchema(SPAN_KIND_NUMBERS).optional(),
    startTimeUnixNano: unixNanoSchema.optional(),
    endTimeUnixNano: unixNanoSchema.optional(),
    attributes: attributesSchema,
    events: z.array(otlpEventSchema).optional(),
    links: z.array(z.unknown()).optional(),
    status: z
      .object({ code: enumNumberSchema(STATUS_CODE_NUMBERS).optional(), message: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose()

export const otlpTraceRequestSchema = z
  .object({
    resourceSpans: z
      .array(
        z
          .object({
            resource: z.object({ attributes: attributesSchema }).loose().optional(),
            scopeSpans: z
              .array(
                z
                  .object({
                    scope: z.object({ name: z.string().optional(), version: z.string().optional() }).loose().optional(),
                    spans: z.array(otlpSpanSchema).optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()

export type OtlpTraceRequest = z.infer<typeof otlpTraceRequestSchema>

const otlpLogRecordSchema = z
  .object({
    timeUnixNano: unixNanoSchema.optional(),
    observedTimeUnixNano: unixNanoSchema.optional(),
    severityNumber: enumNumberSchema(SEVERITY_NUMBERS).optional(),
    severityText: z.string().optional(),
    body: anyValueAt(0).optional(),
    attributes: attributesSchema,
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    eventName: z.string().optional(),
  })
  .loose()

/** The OTLP/HTTP JSON mapping of `ExportLogsServiceRequest`. */
export const otlpLogsRequestSchema = z
  .object({
    resourceLogs: z
      .array(
        z
          .object({
            resource: z.object({ attributes: attributesSchema }).loose().optional(),
            scopeLogs: z
              .array(
                z
                  .object({
                    scope: z.object({ name: z.string().optional(), version: z.string().optional() }).loose().optional(),
                    logRecords: z.array(otlpLogRecordSchema).optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()

export type OtlpLogsRequest = z.infer<typeof otlpLogsRequestSchema>
export type OtlpLogRecord = z.infer<typeof otlpLogRecordSchema>
export type OtlpSpan = z.infer<typeof otlpSpanSchema>

const numericSchema = z.union([z.number(), z.enum(['NaN', 'Infinity', '-Infinity'])])

const otlpPointSchema = z
  .object({
    attributes: attributesSchema,
    timeUnixNano: unixNanoSchema.optional(),
    asDouble: numericSchema.optional(),
    asInt: int64Schema.optional(),
    count: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]).optional(),
    sum: numericSchema.optional(),
    min: numericSchema.optional(),
    max: numericSchema.optional(),
  })
  .loose()

const otlpDataSchema = z
  .object({
    dataPoints: z.array(otlpPointSchema).optional(),
    aggregationTemporality: z.union([z.number().int(), z.string()]).optional(),
    isMonotonic: z.boolean().optional(),
  })
  .loose()

const otlpMetricSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    unit: z.string().optional(),
    gauge: otlpDataSchema.optional(),
    sum: otlpDataSchema.optional(),
    histogram: otlpDataSchema.optional(),
    exponentialHistogram: otlpDataSchema.optional(),
    summary: otlpDataSchema.optional(),
  })
  .loose()

/** The OTLP/HTTP JSON mapping of `ExportMetricsServiceRequest`, limited to the fields the metric charts read. */
export const otlpMetricsRequestSchema = z
  .object({
    resourceMetrics: z
      .array(
        z
          .object({
            resource: z.object({ attributes: attributesSchema }).loose().optional(),
            scopeMetrics: z
              .array(
                z
                  .object({
                    scope: z.object({ name: z.string().optional(), version: z.string().optional() }).loose().optional(),
                    metrics: z.array(otlpMetricSchema).optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()

export type OtlpMetricsRequest = z.infer<typeof otlpMetricsRequestSchema>
export type OtlpMetric = z.infer<typeof otlpMetricSchema>
export type OtlpMetricPoint = z.infer<typeof otlpPointSchema>
