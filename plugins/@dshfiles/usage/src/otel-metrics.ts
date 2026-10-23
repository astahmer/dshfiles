import { z } from 'zod'

const nonnegativeIntegerString = z.string().regex(/^(0|[1-9]\d*)$/)
const attributeSchema = z.object({ key: z.string().min(1).max(128), value: z.object({ stringValue: z.string().max(512) }).strict() }).strict()
const deltaTemporality = 'AGGREGATION_TEMPORALITY_DELTA' as const
const numberPointSchema = z
  .object({
    attributes: z.array(attributeSchema).max(16),
    startTimeUnixNano: nonnegativeIntegerString,
    timeUnixNano: nonnegativeIntegerString,
    asInt: nonnegativeIntegerString.optional(),
    asDouble: z.number().finite().optional(),
  })
  .strict()
  .refine(point => Number(point.asInt !== undefined) + Number(point.asDouble !== undefined) === 1)
const histogramPointSchema = z
  .object({
    attributes: z.array(attributeSchema).max(16),
    startTimeUnixNano: nonnegativeIntegerString,
    timeUnixNano: nonnegativeIntegerString,
    count: nonnegativeIntegerString,
    sum: z.number().finite(),
    bucketCounts: z.array(nonnegativeIntegerString).max(32),
    explicitBounds: z.array(z.number().finite()).max(31),
  })
  .strict()
  .refine(point => point.bucketCounts.length === point.explicitBounds.length + 1)

const metricBase = {
  name: z.string().min(1).max(128),
  description: z.string().max(512),
  unit: z.string().max(32),
}
const metricSchema = z.union([
  z
    .object({
      ...metricBase,
      sum: z
        .object({ dataPoints: z.array(numberPointSchema).max(5_000), aggregationTemporality: z.literal(deltaTemporality), isMonotonic: z.literal(true) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...metricBase,
      histogram: z.object({ dataPoints: z.array(histogramPointSchema).max(5_000), aggregationTemporality: z.literal(deltaTemporality) }).strict(),
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

const keyValues = (attributes: Readonly<Record<string, string>>) =>
  Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value: { stringValue: value } }))

export const createOtlpMetricsRequest = (input: {
  readonly from: number
  readonly to: number
  readonly counters: readonly OtlpCounterInput[]
  readonly histograms: readonly OtlpHistogramInput[]
}): OtlpMetricsRequest => {
  const startTimeUnixNano = (BigInt(input.from) * 1_000_000n).toString()
  const timeUnixNano = (BigInt(input.to) * 1_000_000n).toString()
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
          ...(point.asDouble === true ? { asDouble: point.value } : { asInt: String(point.value) }),
        })),
        aggregationTemporality: deltaTemporality,
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
          count: String(point.count),
          sum: point.sum,
          bucketCounts: point.bucketCounts.map(String),
          explicitBounds: [...histogram.bounds],
        })),
        aggregationTemporality: deltaTemporality,
      },
    })),
  ]
  return otlpMetricsRequestSchema.parse({
    resourceMetrics: [
      {
        resource: { attributes: keyValues({ 'service.name': 'dsh', 'service.namespace': 'dshfiles' }) },
        scopeMetrics: [{ scope: { name: '@dshfiles/usage', version: '0.1.0' }, metrics }],
      },
    ],
  })
}
