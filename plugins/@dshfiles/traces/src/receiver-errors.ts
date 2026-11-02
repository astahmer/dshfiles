import { Schema } from 'effect'

export const PORT_RETRY_SECONDS = 30

export class PortInUse extends Schema.TaggedError<PortInUse>()(
  'PortInUse',
  { host: Schema.String, port: Schema.Int, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'port-in-use' },
) {
  override get message(): string {
    return `Port ${String(this.port)} on ${this.host} is held by another process (an OpenTelemetry collector or dsh-traces, for instance). Stored traces stay browsable; the receiver retries every ${String(PORT_RETRY_SECONDS)} s.`
  }
}

export class ReceiverListenFailed extends Schema.TaggedError<ReceiverListenFailed>()(
  'ReceiverListenFailed',
  { host: Schema.String, port: Schema.Int, reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'receiver-listen-failed' },
) {
  override get message(): string {
    return this.reason
  }
}

export class NonLoopbackRefused extends Schema.TaggedError<NonLoopbackRefused>()(
  'NonLoopbackRefused',
  { host: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'non-loopback-refused' },
) {
  override get message(): string {
    return `Refusing to listen on ${this.host}: a non-loopback address exposes the receiver to the network. Turn on "Allow a non-loopback address" to opt in.`
  }
}

/** A client error on one OTLP request, answered with its status and a JSON `{ code, message }` body. */
export class OtlpRequestRejected extends Schema.TaggedError<OtlpRequestRejected>()(
  'OtlpRequestRejected',
  { status: Schema.Literals([400, 404, 405, 413, 415]), reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'otlp-request-rejected' },
) {
  override get message(): string {
    return this.reason
  }
}

export class ForwardFailed extends Schema.TaggedError<ForwardFailed>()(
  'ForwardFailed',
  { target: Schema.String, status: Schema.optional(Schema.Int), reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'forward-failed' },
) {
  override get message(): string {
    return this.reason
  }
}
