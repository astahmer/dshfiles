import * as Schema from 'effect/Schema'

const nonnegativeIntegerString = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)$/))

const attributeSchema = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  value: Schema.Struct({ stringValue: Schema.String.check(Schema.isMaxLength(512)) }),
})

// OTLP/JSON forbids enum names: AggregationTemporality is encoded as its proto number.
const AGGREGATION_TEMPORALITY = { delta: 1, cumulative: 2 } as const
export type OtlpTemporality = keyof typeof AGGREGATION_TEMPORALITY
const temporalitySchema = Schema.Literals([AGGREGATION_TEMPORALITY.delta, AGGREGATION_TEMPORALITY.cumulative])

interface UnixNanoRange {
  readonly startTimeUnixNano: string
  readonly timeUnixNano: string
}

const timeRangeIsOrdered = Schema.makeFilter((point: UnixNanoRange) =>
  BigInt(point.startTimeUnixNano) <= BigInt(point.timeUnixNano) ? true : 'startTimeUnixNano must be at or before timeUnixNano.',
)

const numberPointSchema = Schema.Struct({
  attributes: Schema.Array(attributeSchema).check(Schema.isMaxLength(16)),
  startTimeUnixNano: nonnegativeIntegerString,
  timeUnixNano: nonnegativeIntegerString,
  asInt: Schema.optional(nonnegativeIntegerString),
  asDouble: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
})
  .check(
    Schema.makeFilter(
      (point: { readonly asInt?: string | undefined; readonly asDouble?: number | undefined }) =>
        Number(point.asInt !== undefined) + Number(point.asDouble !== undefined) === 1 || 'Exactly one of asInt or asDouble is required.',
    ),
  )
  .check(timeRangeIsOrdered)

interface HistogramPointShape extends UnixNanoRange {
  readonly count: string
  readonly bucketCounts: readonly string[]
  readonly explicitBounds: readonly number[]
}

const histogramPointSchema = Schema.Struct({
  attributes: Schema.Array(attributeSchema).check(Schema.isMaxLength(16)),
  startTimeUnixNano: nonnegativeIntegerString,
  timeUnixNano: nonnegativeIntegerString,
  count: nonnegativeIntegerString,
  sum: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  bucketCounts: Schema.Array(nonnegativeIntegerString).check(Schema.isMaxLength(32)),
  explicitBounds: Schema.Array(Schema.Number.check(Schema.isFinite())).check(Schema.isMaxLength(31)),
})
  .check(
    Schema.makeFilter((point: HistogramPointShape) =>
      point.bucketCounts.length === point.explicitBounds.length + 1 ? true : 'bucketCounts must hold one more entry than explicitBounds.',
    ),
  )
  .check(
    Schema.makeFilter(
      (point: HistogramPointShape) =>
        point.explicitBounds.every((bound, index) => index === 0 || bound > (point.explicitBounds[index - 1] ?? bound)) ||
        'explicitBounds must be strictly increasing.',
    ),
  )
  .check(
    Schema.makeFilter(
      (point: HistogramPointShape) =>
        point.bucketCounts.reduce((total, bucket) => total + BigInt(bucket), 0n) === BigInt(point.count) || 'bucketCounts must sum to count.',
    ),
  )
  .check(timeRangeIsOrdered)

const metricBase = {
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  description: Schema.String.check(Schema.isMaxLength(512)),
  unit: Schema.String.check(Schema.isMaxLength(32)),
}

const metricSchema = Schema.Union([
  Schema.Struct({
    ...metricBase,
    sum: Schema.Struct({
      dataPoints: Schema.Array(numberPointSchema).check(Schema.isMaxLength(5_000)),
      aggregationTemporality: temporalitySchema,
      isMonotonic: Schema.Literal(true),
    }),
  }),
  Schema.Struct({
    ...metricBase,
    histogram: Schema.Struct({
      dataPoints: Schema.Array(histogramPointSchema).check(Schema.isMaxLength(5_000)),
      aggregationTemporality: temporalitySchema,
    }),
  }),
])

export const otlpMetricsRequestSchema = Schema.Struct({
  resourceMetrics: Schema.Array(
    Schema.Struct({
      resource: Schema.Struct({ attributes: Schema.Array(attributeSchema).check(Schema.isMaxLength(16)) }),
      scopeMetrics: Schema.Array(
        Schema.Struct({
          scope: Schema.Struct({
            name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
            version: Schema.String.check(Schema.isMaxLength(32)),
          }),
          metrics: Schema.Array(metricSchema).check(Schema.isMaxLength(16)),
        }),
      ).check(Schema.isMaxLength(4)),
    }),
  ).check(Schema.isMaxLength(1)),
})

export type OtlpMetricsRequest = typeof otlpMetricsRequestSchema.Type
export type OtlpMetric = OtlpMetricsRequest['resourceMetrics'][number]['scopeMetrics'][number]['metrics'][number]

export interface OtlpCounterInput {
  readonly name: string
  readonly description: string
  readonly unit: string
  readonly points: readonly { readonly attributes: Readonly<Record<string, string>>; readonly value: number; readonly asDouble?: boolean }[]
}

export interface OtlpHistogramInput {
  readonly name: string
  readonly description: string
  readonly unit: string
  readonly bounds: readonly number[]
  readonly points: readonly {
    readonly attributes: Readonly<Record<string, string>>
    readonly count: number
    readonly sum: number
    readonly bucketCounts: readonly number[]
  }[]
}

export const DEFAULT_OTLP_SERVICE_NAME = 'dshfiles'

const keyValues = (attributes: Readonly<Record<string, string>>) =>
  Object.entries(attributes)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => ({ key, value: { stringValue: value } }))

const unixNanoOf = (unixMs: number) => (BigInt(unixMs) * 1_000_000n).toString()

const int64StringOf = (value: number) => BigInt(Math.trunc(value)).toString()

export const createOtlpMetricsRequest = (input: {
  readonly from: number
  readonly to: number
  readonly temporality: OtlpTemporality
  readonly serviceName: string
  readonly counters: readonly OtlpCounterInput[]
  readonly histograms: readonly OtlpHistogramInput[]
}): OtlpMetricsRequest => {
  const aggregationTemporality = AGGREGATION_TEMPORALITY[input.temporality]
  const startTimeUnixNano = unixNanoOf(input.from)
  const timeUnixNano = unixNanoOf(input.to)
  const metrics: OtlpMetric[] = [
    ...input.counters.map(counter => ({
      name: counter.name,
      description: counter.description,
      unit: counter.unit,
      sum: {
        dataPoints: counter.points.map(point => ({
          attributes: keyValues(point.attributes),
          startTimeUnixNano,
          timeUnixNano,
          ...(point.asDouble === true ? { asDouble: point.value } : { asInt: int64StringOf(point.value) }),
        })),
        aggregationTemporality,
        isMonotonic: true as const,
      },
    })),
    ...input.histograms.map(histogram => ({
      name: histogram.name,
      description: histogram.description,
      unit: histogram.unit,
      histogram: {
        dataPoints: histogram.points.map(point => ({
          attributes: keyValues(point.attributes),
          startTimeUnixNano,
          timeUnixNano,
          count: int64StringOf(point.count),
          sum: point.sum,
          bucketCounts: point.bucketCounts.map(int64StringOf),
          explicitBounds: [...histogram.bounds],
        })),
        aggregationTemporality,
      },
    })),
  ]
  return Schema.decodeUnknownSync(otlpMetricsRequestSchema)({
    resourceMetrics: [
      {
        resource: { attributes: keyValues({ 'service.name': input.serviceName }) },
        scopeMetrics: [{ scope: { name: '@dshfiles/usage', version: '0.1.0' }, metrics }],
      },
    ],
  })
}
