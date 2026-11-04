import { Effect, Schema } from 'effect'
import { OtlpRequestRejected } from '../receiver-errors.js'
import { otlpLogsRequestSchema, otlpMetricsRequestSchema, otlpTraceRequestSchema } from './json-schema.js'
import { OtlpProtobuf, ProtobufDecodeError } from './protobuf.js'

export type Wire = 'json' | 'protobuf'
export type OtlpSignal = 'traces' | 'metrics' | 'logs'
export type OtlpBodyInput = { readonly body: Buffer; readonly wire: Wire }

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const decoderOf = <Decoded>(input: { readonly schema: Schema.Decoder<Decoded>; readonly protobuf: (bytes: Uint8Array) => Decoded; readonly label: string }) => {
  const decodeJson = Schema.decodeUnknownEffect(input.schema)
  return (body: OtlpBodyInput): Effect.Effect<Decoded, OtlpRequestRejected> => {
    if (body.wire === 'protobuf')
      return Effect.try({
        try: () => input.protobuf(body.body),
        catch: cause =>
          new OtlpRequestRejected({
            status: 400,
            reason: cause instanceof ProtobufDecodeError ? cause.message : `The protobuf body is not an ${input.label}.`,
            cause,
          }),
      })
    return parseJson(body.body.toString('utf8')).pipe(
      Effect.mapError(cause => new OtlpRequestRejected({ status: 400, reason: 'The JSON body could not be parsed.', cause })),
      Effect.flatMap(json =>
        Effect.mapError(decodeJson(json), cause => new OtlpRequestRejected({ status: 400, reason: `The JSON body is not an OTLP ${input.label}.`, cause })),
      ),
    )
  }
}

export class OtlpBody {
  static readonly decodeTraces = decoderOf({ schema: otlpTraceRequestSchema, protobuf: OtlpProtobuf.decodeTraces, label: 'ExportTraceServiceRequest' })
  static readonly decodeLogs = decoderOf({ schema: otlpLogsRequestSchema, protobuf: OtlpProtobuf.decodeLogs, label: 'ExportLogsServiceRequest' })
  static readonly decodeMetrics = decoderOf({ schema: otlpMetricsRequestSchema, protobuf: OtlpProtobuf.decodeMetrics, label: 'ExportMetricsServiceRequest' })
}
