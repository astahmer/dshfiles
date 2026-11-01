import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

/**
 * The OTLP/HTTP JSON mapping of `ExportTraceServiceRequest`
 * (https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding). The protobuf decoder emits the same shape, so
 * both wire formats cross this one schema before anything is stored.
 */

const MAX_ANY_VALUE_DEPTH = 8

const int64Schema = Schema.Union([Schema.String.check(Schema.isPattern(/^-?\d{1,20}$/)), Schema.Int])
const unixNanoSchema = Schema.Union([Schema.String.check(Schema.isPattern(/^\d{1,20}$/)), Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))])

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

/** Past the depth bound the payload is left unread, exactly as the encoder forbids deeper nesting. */
const opaqueObject: Schema.ConstraintDecoder<OtlpAnyValue> = Schema.Unknown.pipe(
  Schema.refine((value): value is OtlpAnyValue => typeof value === 'object' && value !== null),
)

const anyValueAt = (depth: number): Schema.ConstraintDecoder<OtlpAnyValue> =>
  Schema.suspend(() =>
    depth >= MAX_ANY_VALUE_DEPTH
      ? opaqueObject
      : Schema.Struct({
          stringValue: Schema.optional(Schema.String),
          boolValue: Schema.optional(Schema.Boolean),
          intValue: Schema.optional(int64Schema),
          doubleValue: Schema.optional(Schema.Union([Schema.Number, Schema.Literals(['NaN', 'Infinity', '-Infinity'])])),
          bytesValue: Schema.optional(Schema.String),
          arrayValue: Schema.optional(Schema.Struct({ values: Schema.optional(Schema.Array(anyValueAt(depth + 1))) })),
          kvlistValue: Schema.optional(Schema.Struct({ values: Schema.optional(Schema.Array(keyValueAt(depth + 1))) })),
        }),
  )

const keyValueAt = (depth: number): Schema.ConstraintDecoder<OtlpKeyValue> =>
  Schema.suspend(() => Schema.Struct({ key: Schema.String, value: Schema.optional(anyValueAt(depth)) }))

const attributesSchema = Schema.optional(Schema.Array(keyValueAt(0)))

const otlpEventSchema = Schema.Struct({
  timeUnixNano: Schema.optional(unixNanoSchema),
  name: Schema.optional(Schema.String),
  attributes: attributesSchema,
})

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
const enumNumberSchema = (numbers: ReadonlyMap<string, number>) =>
  Schema.Union([
    Schema.Int,
    Schema.String.pipe(
      Schema.decodeTo(Schema.Int, {
        decode: SchemaGetter.transform<number, string>(name => numbers.get(name) ?? 0),
        encode: SchemaGetter.transform<string, number>(value => String(value)),
      }),
    ),
  ])

const otlpSpanSchema = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  kind: Schema.optional(enumNumberSchema(SPAN_KIND_NUMBERS)),
  startTimeUnixNano: Schema.optional(unixNanoSchema),
  endTimeUnixNano: Schema.optional(unixNanoSchema),
  attributes: attributesSchema,
  events: Schema.optional(Schema.Array(otlpEventSchema)),
  links: Schema.optional(Schema.Array(Schema.Unknown)),
  status: Schema.optional(
    Schema.Struct({
      code: Schema.optional(enumNumberSchema(STATUS_CODE_NUMBERS)),
      message: Schema.optional(Schema.String),
    }),
  ),
})

export const otlpTraceRequestSchema = Schema.Struct({
  resourceSpans: Schema.optional(
    Schema.Array(
      Schema.Struct({
        resource: Schema.optional(Schema.Struct({ attributes: attributesSchema })),
        scopeSpans: Schema.optional(
          Schema.Array(
            Schema.Struct({
              scope: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String), version: Schema.optional(Schema.String) })),
              spans: Schema.optional(Schema.Array(otlpSpanSchema)),
            }),
          ),
        ),
      }),
    ),
  ),
})

export type OtlpTraceRequest = Schema.Schema.Type<typeof otlpTraceRequestSchema>

const otlpLogRecordSchema = Schema.Struct({
  timeUnixNano: Schema.optional(unixNanoSchema),
  observedTimeUnixNano: Schema.optional(unixNanoSchema),
  severityNumber: Schema.optional(enumNumberSchema(SEVERITY_NUMBERS)),
  severityText: Schema.optional(Schema.String),
  body: Schema.optional(anyValueAt(0)),
  attributes: attributesSchema,
  traceId: Schema.optional(Schema.String),
  spanId: Schema.optional(Schema.String),
  eventName: Schema.optional(Schema.String),
})

/** The OTLP/HTTP JSON mapping of `ExportLogsServiceRequest`. */
export const otlpLogsRequestSchema = Schema.Struct({
  resourceLogs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        resource: Schema.optional(Schema.Struct({ attributes: attributesSchema })),
        scopeLogs: Schema.optional(
          Schema.Array(
            Schema.Struct({
              scope: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String), version: Schema.optional(Schema.String) })),
              logRecords: Schema.optional(Schema.Array(otlpLogRecordSchema)),
            }),
          ),
        ),
      }),
    ),
  ),
})

export type OtlpLogsRequest = Schema.Schema.Type<typeof otlpLogsRequestSchema>
export type OtlpLogRecord = Schema.Schema.Type<typeof otlpLogRecordSchema>
export type OtlpSpan = Schema.Schema.Type<typeof otlpSpanSchema>

const numericSchema = Schema.Union([Schema.Number, Schema.Literals(['NaN', 'Infinity', '-Infinity'])])

const otlpPointSchema = Schema.Struct({
  attributes: attributesSchema,
  timeUnixNano: Schema.optional(unixNanoSchema),
  asDouble: Schema.optional(numericSchema),
  asInt: Schema.optional(int64Schema),
  count: Schema.optional(Schema.Union([Schema.String.check(Schema.isPattern(/^\d{1,20}$/)), Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))])),
  sum: Schema.optional(numericSchema),
  min: Schema.optional(numericSchema),
  max: Schema.optional(numericSchema),
})

const otlpDataSchema = Schema.Struct({
  dataPoints: Schema.optional(Schema.Array(otlpPointSchema)),
  aggregationTemporality: Schema.optional(Schema.Union([Schema.Int, Schema.String])),
  isMonotonic: Schema.optional(Schema.Boolean),
})

const otlpMetricSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  unit: Schema.optional(Schema.String),
  gauge: Schema.optional(otlpDataSchema),
  sum: Schema.optional(otlpDataSchema),
  histogram: Schema.optional(otlpDataSchema),
  exponentialHistogram: Schema.optional(otlpDataSchema),
  summary: Schema.optional(otlpDataSchema),
})

/** The OTLP/HTTP JSON mapping of `ExportMetricsServiceRequest`, limited to the fields the metric charts read. */
export const otlpMetricsRequestSchema = Schema.Struct({
  resourceMetrics: Schema.optional(
    Schema.Array(
      Schema.Struct({
        resource: Schema.optional(Schema.Struct({ attributes: attributesSchema })),
        scopeMetrics: Schema.optional(
          Schema.Array(
            Schema.Struct({
              scope: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String), version: Schema.optional(Schema.String) })),
              metrics: Schema.optional(Schema.Array(otlpMetricSchema)),
            }),
          ),
        ),
      }),
    ),
  ),
})

export type OtlpMetricsRequest = Schema.Schema.Type<typeof otlpMetricsRequestSchema>
export type OtlpMetric = Schema.Schema.Type<typeof otlpMetricSchema>
export type OtlpMetricPoint = Schema.Schema.Type<typeof otlpPointSchema>
