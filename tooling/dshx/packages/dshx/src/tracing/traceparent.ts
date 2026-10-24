/** Runtime-neutral W3C Trace Context helpers, shared by the Host tracer and the browser tracer. */

export interface SpanContext {
  readonly traceId: string
  readonly spanId: string
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/u
const NON_ZERO = /[^0]/u

/** Read a W3C `traceparent` header (version 00); anything else, including all-zero ids, is ignored. */
const parse = (header: unknown): SpanContext | undefined => {
  if (typeof header !== 'string') return undefined
  const match = TRACEPARENT.exec(header.trim().toLowerCase())
  if (match === null) return undefined
  const [, traceId = '', spanId = ''] = match
  if (!NON_ZERO.test(traceId) || !NON_ZERO.test(spanId)) return undefined
  return { traceId, spanId }
}

const format = (context: SpanContext): string => `00-${context.traceId}-${context.spanId}-01`

/**
 * The browser's dshx API calls travel through the native Connection RPC, which sends no custom headers, so the
 * caller's `traceparent` rides in the dshx request envelope next to `version` and `input`. Hosts that predate it
 * ignore the extra field.
 */
const ENVELOPE_FIELD = 'traceparent'

const fromEnvelope = (payload: unknown): SpanContext | undefined =>
  typeof payload === 'object' && payload !== null && ENVELOPE_FIELD in payload ? parse(payload[ENVELOPE_FIELD]) : undefined

export class TraceparentModel {
  static readonly parse = parse
  static readonly format = format
  static readonly envelopeField = ENVELOPE_FIELD
  static readonly fromEnvelope = fromEnvelope
}
