import type { z } from 'zod'
import { RequestRejection, type Wire } from '../receiver.js'
import {
  otlpLogsRequestSchema,
  otlpMetricsRequestSchema,
  otlpTraceRequestSchema,
  type OtlpLogsRequest,
  type OtlpMetricsRequest,
  type OtlpTraceRequest,
} from './json-schema.js'
import { OtlpProtobuf, ProtobufDecodeError } from './protobuf.js'

const decodeJsonBody = <Decoded>(body: Buffer, schema: z.ZodType<Decoded>, label: string): Decoded => {
  let json: unknown
  try {
    json = JSON.parse(body.toString('utf8'))
  } catch {
    throw new RequestRejection(400, 'The JSON body could not be parsed.')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new RequestRejection(400, `The JSON body is not an OTLP ${label}.`)
  return parsed.data
}

const decodeProtobufBody = <Decoded>(body: Buffer, decode: (bytes: Uint8Array) => Decoded, label: string): Decoded => {
  try {
    return decode(body)
  } catch (error) {
    throw new RequestRejection(400, error instanceof ProtobufDecodeError ? error.message : `The protobuf body is not an ${label}.`)
  }
}

const decodeTraceBody = (input: { readonly body: Buffer; readonly wire: Wire }): OtlpTraceRequest => {
  if (input.wire === 'protobuf') return decodeProtobufBody(input.body, OtlpProtobuf.decodeTraces, 'ExportTraceServiceRequest')
  return decodeJsonBody(input.body, otlpTraceRequestSchema, 'ExportTraceServiceRequest')
}

const decodeLogsBody = (input: { readonly body: Buffer; readonly wire: Wire }): OtlpLogsRequest => {
  if (input.wire === 'protobuf') return decodeProtobufBody(input.body, OtlpProtobuf.decodeLogs, 'ExportLogsServiceRequest')
  return decodeJsonBody(input.body, otlpLogsRequestSchema, 'ExportLogsServiceRequest')
}

const decodeMetricsBody = (input: { readonly body: Buffer; readonly wire: Wire }): OtlpMetricsRequest => {
  if (input.wire === 'protobuf') return decodeProtobufBody(input.body, OtlpProtobuf.decodeMetrics, 'ExportMetricsServiceRequest')
  return decodeJsonBody(input.body, otlpMetricsRequestSchema, 'ExportMetricsServiceRequest')
}

export class OtlpBody {
  static readonly decodeTraces = decodeTraceBody
  static readonly decodeLogs = decodeLogsBody
  static readonly decodeMetrics = decodeMetricsBody
}
