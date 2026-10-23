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

const parseJsonBody = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new RequestRejection(400, 'The JSON body could not be parsed.')
  }
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
  const parsed = otlpTraceRequestSchema.safeParse(parseJsonBody(input.body))
  if (!parsed.success) throw new RequestRejection(400, 'The JSON body is not an OTLP ExportTraceServiceRequest.')
  return parsed.data
}

const decodeLogsBody = (input: { readonly body: Buffer; readonly wire: Wire }): OtlpLogsRequest => {
  if (input.wire === 'protobuf') return decodeProtobufBody(input.body, OtlpProtobuf.decodeLogs, 'ExportLogsServiceRequest')
  const parsed = otlpLogsRequestSchema.safeParse(parseJsonBody(input.body))
  if (!parsed.success) throw new RequestRejection(400, 'The JSON body is not an OTLP ExportLogsServiceRequest.')
  return parsed.data
}

const decodeMetricsBody = (input: { readonly body: Buffer; readonly wire: Wire }): OtlpMetricsRequest => {
  if (input.wire === 'protobuf') return decodeProtobufBody(input.body, OtlpProtobuf.decodeMetrics, 'ExportMetricsServiceRequest')
  const parsed = otlpMetricsRequestSchema.safeParse(parseJsonBody(input.body))
  if (!parsed.success) throw new RequestRejection(400, 'The JSON body is not an OTLP ExportMetricsServiceRequest.')
  return parsed.data
}

export class OtlpBody {
  static readonly decodeTraces = decodeTraceBody
  static readonly decodeLogs = decodeLogsBody
  static readonly decodeMetrics = decodeMetricsBody
}
