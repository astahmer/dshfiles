import { z } from 'zod'

const nonnegativeIntegerString = z.string().regex(/^(0|[1-9]\d*)$/)
const attributeSchema = z.object({ key: z.string().min(1).max(128), value: z.object({ stringValue: z.string().max(512) }).strict() }).strict()
// OTLP/JSON forbids enum names: AggregationTemporality is encoded as its proto number.
const AGGREGATION_TEMPORALITY = { delta: 1, cumulative: 2 } as const
export type OtlpTemporality = keyof typeof AGGREGATION_TEMPORALITY
const temporalitySchema = z.union([z.literal(AGGREGATION_TEMPORALITY.delta), z.literal(AGGREGATION_TEMPORALITY.cumulative)])
const timeRangeIsOrdered = (point: { readonly startTimeUnixNano: string; readonly timeUnixNano: string }) =>
  BigInt(point.startTimeUnixNano) <= BigInt(point.timeUnixNano)
const numberPointSchema = z
  .object({
    attributes: z.array(attributeSchema).max(16),
    startTimeUnixNano: nonnegativeIntegerString,
    timeUnixNano: nonnegativeIntegerString,
    asInt: nonnegativeIntegerString.optional(),
    asDouble: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(point => Number(point.asInt !== undefined) + Number(point.asDouble !== undefined) === 1)
  .refine(timeRangeIsOrdered)
const histogramPointSchema = z
  .object({
    attributes: z.array(attributeSchema).max(16),
    startTimeUnixNano: nonnegativeIntegerString,
    timeUnixNano: nonnegativeIntegerString,
    count: nonnegativeIntegerString,
    sum: z.number().finite().nonnegative(),
    bucketCounts: z.array(nonnegativeIntegerString).max(32),
    explicitBounds: z.array(z.number().finite()).max(31),
  })
  .strict()
  .refine(point => point.bucketCounts.length === point.explicitBounds.length + 1)
  .refine(point => point.explicitBounds.every((bound, index) => index === 0 || bound > (point.explicitBounds[index - 1] ?? bound)))
  .refine(point => point.bucketCounts.reduce((total, bucket) => total + BigInt(bucket), 0n) === BigInt(point.count))
  .refine(timeRangeIsOrdered)

const metricBase = {
  name: z.string().min(1).max(128),
  description: z.string().max(512),
  unit: z.string().max(32),
}
const metricSchema = z.union([
  z
    .object({
      ...metricBase,
      sum: z.object({ dataPoints: z.array(numberPointSchema).max(5_000), aggregationTemporality: temporalitySchema, isMonotonic: z.literal(true) }).strict(),
    })
    .strict(),
  z
    .object({
      ...metricBase,
      histogram: z.object({ dataPoints: z.array(histogramPointSchema).max(5_000), aggregationTemporality: temporalitySchema }).strict(),
    })
    .strict(),
])

export const otlpMetricsRequestSchema = z
  .object({
    resourceMetrics: z
      .array(
        z
          .object({
            resource: z.object({ attributes: z.array(attributeSchema).max(16) }).strict(),
            scopeMetrics: z
              .array(
                z
                  .object({
                    scope: z.object({ name: z.string().min(1).max(128), version: z.string().max(32) }).strict(),
                    metrics: z.array(metricSchema).max(16),
                  })
                  .strict(),
              )
              .max(4),
          })
          .strict(),
      )
      .max(1),
  })
  .strict()

export type OtlpMetricsRequest = z.infer<typeof otlpMetricsRequestSchema>
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
  return otlpMetricsRequestSchema.parse({
    resourceMetrics: [
      {
        resource: { attributes: keyValues({ 'service.name': input.serviceName }) },
        scopeMetrics: [{ scope: { name: '@dshfiles/usage', version: '0.1.0' }, metrics }],
      },
    ],
  })
}
