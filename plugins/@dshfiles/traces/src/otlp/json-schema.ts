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

const otlpSpanSchema = z
  .object({
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    name: z.string().optional(),
    kind: z.union([z.number().int(), z.string()]).optional(),
    startTimeUnixNano: unixNanoSchema.optional(),
    endTimeUnixNano: unixNanoSchema.optional(),
    attributes: attributesSchema,
    events: z.array(otlpEventSchema).optional(),
    links: z.array(z.unknown()).optional(),
    status: z
      .object({ code: z.union([z.number().int(), z.string()]).optional(), message: z.string().optional() })
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
export type OtlpSpan = z.infer<typeof otlpSpanSchema>
