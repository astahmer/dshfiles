import type { OtlpAnyValue, OtlpKeyValue, OtlpLogsRequest, OtlpMetricsRequest, OtlpTraceRequest } from './json-schema.js'

/**
 * A minimal decoder for `opentelemetry.proto.collector.{trace,logs}.v1.Export*ServiceRequest` (opentelemetry-proto v1.x
 * field numbers). It emits the OTLP JSON mapping, so the protobuf and JSON bodies share one validation and one
 * normalizer. Unknown fields are skipped by wire type, as protobuf requires; truncated or malformed input throws.
 */

export class ProtobufDecodeError extends Error {
  override readonly name = 'ProtobufDecodeError'
}

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH = 2
const WIRE_FIXED32 = 5
const MAX_ANY_VALUE_DEPTH = 8

type Reader = {
  readonly done: () => boolean
  readonly tag: () => { readonly field: number; readonly wireType: number }
  readonly varint: () => bigint
  readonly fixed64: () => bigint
  readonly double: () => number
  readonly bytes: () => Uint8Array
  readonly skip: (wireType: number) => void
}

const utf8 = new TextDecoder('utf-8', { fatal: false })

const createReader = (buffer: Uint8Array): Reader => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let position = 0
  const need = (count: number): void => {
    if (position + count > buffer.length) throw new ProtobufDecodeError('Truncated protobuf message.')
  }
  const varint = (): bigint => {
    let result = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      need(1)
      const byte = buffer[position] ?? 0
      position += 1
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return BigInt.asUintN(64, result)
    }
    throw new ProtobufDecodeError('Malformed varint.')
  }
  const length = (): number => {
    const value = Number(varint())
    need(value)
    return value
  }
  return {
    done: () => position >= buffer.length,
    tag: () => {
      const value = Number(varint())
      const field = value >>> 3
      if (field === 0) throw new ProtobufDecodeError('Invalid field number 0.')
      return { field, wireType: value & 7 }
    },
    varint,
    fixed64: () => {
      need(8)
      const value = view.getBigUint64(position, true)
      position += 8
      return value
    },
    double: () => {
      need(8)
      const value = view.getFloat64(position, true)
      position += 8
      return value
    },
    bytes: () => {
      const size = length()
      const slice = buffer.subarray(position, position + size)
      position += size
      return slice
    },
    skip: wireType => {
      if (wireType === WIRE_VARINT) varint()
      else if (wireType === WIRE_FIXED64) {
        need(8)
        position += 8
      } else if (wireType === WIRE_LENGTH) {
        // Read the length first: `position += length()` would add it to the position from before its own varint.
        const size = length()
        position += size
      } else if (wireType === WIRE_FIXED32) {
        need(4)
        position += 4
      } else throw new ProtobufDecodeError(`Unsupported wire type ${String(wireType)}.`)
    },
  }
}

const expectWire = (actual: number, expected: number): void => {
  if (actual !== expected) throw new ProtobufDecodeError(`Unexpected wire type ${String(actual)}.`)
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const toText = (bytes: Uint8Array): string => utf8.decode(bytes)

const readMessage = (bytes: Uint8Array, onField: (reader: Reader, field: number, wireType: number) => boolean): void => {
  const reader = createReader(bytes)
  while (!reader.done()) {
    const { field, wireType } = reader.tag()
    if (!onField(reader, field, wireType)) reader.skip(wireType)
  }
}

const decodeAnyValue = (bytes: Uint8Array, depth: number): OtlpAnyValue => {
  let value: OtlpAnyValue = {}
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) value = { stringValue: toText(reader.bytes()) }
    else if (field === 2 && wireType === WIRE_VARINT) value = { boolValue: reader.varint() !== 0n }
    else if (field === 3 && wireType === WIRE_VARINT) value = { intValue: BigInt.asIntN(64, reader.varint()).toString() }
    else if (field === 4 && wireType === WIRE_FIXED64) value = { doubleValue: reader.double() }
    else if (field === 5 && wireType === WIRE_LENGTH) {
      const inner = reader.bytes()
      value = depth >= MAX_ANY_VALUE_DEPTH ? { stringValue: '[nested too deep]' } : { arrayValue: { values: decodeRepeated(inner, depth + 1, decodeAnyValue) } }
    } else if (field === 6 && wireType === WIRE_LENGTH) {
      const inner = reader.bytes()
      value =
        depth >= MAX_ANY_VALUE_DEPTH ? { stringValue: '[nested too deep]' } : { kvlistValue: { values: decodeRepeated(inner, depth + 1, decodeKeyValue) } }
    } else if (field === 7 && wireType === WIRE_LENGTH) value = { bytesValue: Buffer.from(reader.bytes()).toString('base64') }
    else return false
    return true
  })
  return value
}

const decodeRepeated = <Item>(bytes: Uint8Array, depth: number, decodeItem: (item: Uint8Array, depth: number) => Item): Item[] => {
  const items: Item[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1) return false
    expectWire(wireType, WIRE_LENGTH)
    items.push(decodeItem(reader.bytes(), depth))
    return true
  })
  return items
}

const decodeKeyValue = (bytes: Uint8Array, depth = 0): OtlpKeyValue => {
  let key = ''
  let value: OtlpAnyValue | undefined
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) key = toText(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) value = decodeAnyValue(reader.bytes(), depth)
    else return false
    return true
  })
  return value === undefined ? { key } : { key, value }
}

type MutableEvent = { timeUnixNano?: string; name?: string; attributes: OtlpKeyValue[] }

const decodeEvent = (bytes: Uint8Array): MutableEvent => {
  const event: MutableEvent = { attributes: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_FIXED64) event.timeUnixNano = reader.fixed64().toString()
    else if (field === 2 && wireType === WIRE_LENGTH) event.name = toText(reader.bytes())
    else if (field === 3 && wireType === WIRE_LENGTH) event.attributes.push(decodeKeyValue(reader.bytes()))
    else return false
    return true
  })
  return event
}

type DecodedStatus = { code?: number; message?: string }

const decodeStatus = (bytes: Uint8Array): DecodedStatus => {
  const status: DecodedStatus = {}
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 2 && wireType === WIRE_LENGTH) status.message = toText(reader.bytes())
    else if (field === 3 && wireType === WIRE_VARINT) status.code = Number(reader.varint())
    else return false
    return true
  })
  return status
}

type MutableSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name?: string
  kind?: number
  startTimeUnixNano?: string
  endTimeUnixNano?: string
  attributes: OtlpKeyValue[]
  events: MutableEvent[]
  links: unknown[]
  status?: DecodedStatus
}

const decodeSpan = (bytes: Uint8Array): MutableSpan => {
  const span: MutableSpan = { traceId: '', spanId: '', attributes: [], events: [], links: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) span.traceId = toHex(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) span.spanId = toHex(reader.bytes())
    else if (field === 4 && wireType === WIRE_LENGTH) span.parentSpanId = toHex(reader.bytes())
    else if (field === 5 && wireType === WIRE_LENGTH) span.name = toText(reader.bytes())
    else if (field === 6 && wireType === WIRE_VARINT) span.kind = Number(reader.varint())
    else if (field === 7 && wireType === WIRE_FIXED64) span.startTimeUnixNano = reader.fixed64().toString()
    else if (field === 8 && wireType === WIRE_FIXED64) span.endTimeUnixNano = reader.fixed64().toString()
    else if (field === 9 && wireType === WIRE_LENGTH) span.attributes.push(decodeKeyValue(reader.bytes()))
    else if (field === 11 && wireType === WIRE_LENGTH) span.events.push(decodeEvent(reader.bytes()))
    else if (field === 13 && wireType === WIRE_LENGTH) {
      reader.bytes()
      span.links.push({})
    } else if (field === 15 && wireType === WIRE_LENGTH) span.status = decodeStatus(reader.bytes())
    else return false
    return true
  })
  return span
}

type DecodedScope = { name?: string; version?: string }

const decodeScope = (bytes: Uint8Array): DecodedScope => {
  const scope: DecodedScope = {}
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) scope.name = toText(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) scope.version = toText(reader.bytes())
    else return false
    return true
  })
  return scope
}

type DecodedScopeSpans = { scope?: DecodedScope; spans: MutableSpan[] }

const decodeScopeSpans = (bytes: Uint8Array): DecodedScopeSpans => {
  const scopeSpans: DecodedScopeSpans = { spans: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) scopeSpans.scope = decodeScope(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) scopeSpans.spans.push(decodeSpan(reader.bytes()))
    else return false
    return true
  })
  return scopeSpans
}

const decodeResourceAttributes = (bytes: Uint8Array): OtlpKeyValue[] => {
  const attributes: OtlpKeyValue[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1 || wireType !== WIRE_LENGTH) return false
    attributes.push(decodeKeyValue(reader.bytes()))
    return true
  })
  return attributes
}

const decodeResourceSpans = (bytes: Uint8Array) => {
  const attributes: OtlpKeyValue[] = []
  const scopeSpans: DecodedScopeSpans[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) attributes.push(...decodeResourceAttributes(reader.bytes()))
    else if (field === 2 && wireType === WIRE_LENGTH) scopeSpans.push(decodeScopeSpans(reader.bytes()))
    else return false
    return true
  })
  return { resource: { attributes }, scopeSpans }
}

const decodeTraceRequest = (bytes: Uint8Array): OtlpTraceRequest => {
  const resourceSpans: ReturnType<typeof decodeResourceSpans>[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1) return false
    expectWire(wireType, WIRE_LENGTH)
    resourceSpans.push(decodeResourceSpans(reader.bytes()))
    return true
  })
  return { resourceSpans }
}

type MutableLogRecord = {
  timeUnixNano?: string
  observedTimeUnixNano?: string
  severityNumber?: number
  severityText?: string
  body?: OtlpAnyValue
  attributes: OtlpKeyValue[]
  traceId?: string
  spanId?: string
  eventName?: string
}

const decodeLogRecord = (bytes: Uint8Array): MutableLogRecord => {
  const record: MutableLogRecord = { attributes: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_FIXED64) record.timeUnixNano = reader.fixed64().toString()
    else if (field === 2 && wireType === WIRE_VARINT) record.severityNumber = Number(reader.varint())
    else if (field === 3 && wireType === WIRE_LENGTH) record.severityText = toText(reader.bytes())
    else if (field === 5 && wireType === WIRE_LENGTH) record.body = decodeAnyValue(reader.bytes(), 0)
    else if (field === 6 && wireType === WIRE_LENGTH) record.attributes.push(decodeKeyValue(reader.bytes()))
    else if (field === 9 && wireType === WIRE_LENGTH) record.traceId = toHex(reader.bytes())
    else if (field === 10 && wireType === WIRE_LENGTH) record.spanId = toHex(reader.bytes())
    else if (field === 11 && wireType === WIRE_FIXED64) record.observedTimeUnixNano = reader.fixed64().toString()
    else if (field === 12 && wireType === WIRE_LENGTH) record.eventName = toText(reader.bytes())
    else return false
    return true
  })
  return record
}

type DecodedScopeLogs = { scope?: DecodedScope; logRecords: MutableLogRecord[] }

const decodeScopeLogs = (bytes: Uint8Array): DecodedScopeLogs => {
  const scopeLogs: DecodedScopeLogs = { logRecords: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) scopeLogs.scope = decodeScope(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) scopeLogs.logRecords.push(decodeLogRecord(reader.bytes()))
    else return false
    return true
  })
  return scopeLogs
}

const decodeResourceLogs = (bytes: Uint8Array) => {
  const attributes: OtlpKeyValue[] = []
  const scopeLogs: DecodedScopeLogs[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) attributes.push(...decodeResourceAttributes(reader.bytes()))
    else if (field === 2 && wireType === WIRE_LENGTH) scopeLogs.push(decodeScopeLogs(reader.bytes()))
    else return false
    return true
  })
  return { resource: { attributes }, scopeLogs }
}

const decodeLogsRequest = (bytes: Uint8Array): OtlpLogsRequest => {
  const resourceLogs: ReturnType<typeof decodeResourceLogs>[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1) return false
    expectWire(wireType, WIRE_LENGTH)
    resourceLogs.push(decodeResourceLogs(reader.bytes()))
    return true
  })
  return { resourceLogs }
}

type MutablePoint = {
  attributes: OtlpKeyValue[]
  timeUnixNano?: string
  asDouble?: number
  asInt?: string
  count?: string
  sum?: number
  min?: number
  max?: number
}

/** NumberDataPoint, HistogramDataPoint, ExponentialHistogramDataPoint and SummaryDataPoint share these fields. */
const decodePoint = (bytes: Uint8Array, kind: 'number' | 'histogram' | 'exponential' | 'summary'): MutablePoint => {
  const point: MutablePoint = { attributes: [] }
  const attributesField = kind === 'histogram' ? 9 : kind === 'exponential' ? 1 : 7
  const minField = kind === 'exponential' ? 12 : 11
  const maxField = kind === 'exponential' ? 13 : 12
  readMessage(bytes, (reader, field, wireType) => {
    if (field === attributesField && wireType === WIRE_LENGTH) point.attributes.push(decodeKeyValue(reader.bytes()))
    else if (field === 3 && wireType === WIRE_FIXED64) point.timeUnixNano = reader.fixed64().toString()
    else if (kind === 'number' && field === 4 && wireType === WIRE_FIXED64) point.asDouble = reader.double()
    else if (kind === 'number' && field === 6 && wireType === WIRE_FIXED64) point.asInt = BigInt.asIntN(64, reader.fixed64()).toString()
    else if (kind !== 'number' && field === 4 && wireType === WIRE_FIXED64) point.count = reader.fixed64().toString()
    else if (kind !== 'number' && field === 5 && wireType === WIRE_FIXED64) point.sum = reader.double()
    else if ((kind === 'histogram' || kind === 'exponential') && field === minField && wireType === WIRE_FIXED64) point.min = reader.double()
    else if ((kind === 'histogram' || kind === 'exponential') && field === maxField && wireType === WIRE_FIXED64) point.max = reader.double()
    else return false
    return true
  })
  return point
}

type DecodedData = { dataPoints: MutablePoint[]; aggregationTemporality?: number; isMonotonic?: boolean }

const decodeData = (bytes: Uint8Array, kind: 'number' | 'histogram' | 'exponential' | 'summary', withSumFields: boolean): DecodedData => {
  const data: DecodedData = { dataPoints: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) data.dataPoints.push(decodePoint(reader.bytes(), kind))
    else if (withSumFields && field === 2 && wireType === WIRE_VARINT) data.aggregationTemporality = Number(reader.varint())
    else if (withSumFields && field === 3 && wireType === WIRE_VARINT) data.isMonotonic = reader.varint() !== 0n
    else return false
    return true
  })
  return data
}

type DecodedMetric = {
  name?: string
  description?: string
  unit?: string
  gauge?: DecodedData
  sum?: DecodedData
  histogram?: DecodedData
  exponentialHistogram?: DecodedData
  summary?: DecodedData
}

const decodeMetric = (bytes: Uint8Array): DecodedMetric => {
  const metric: DecodedMetric = {}
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) metric.name = toText(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) metric.description = toText(reader.bytes())
    else if (field === 3 && wireType === WIRE_LENGTH) metric.unit = toText(reader.bytes())
    else if (field === 5 && wireType === WIRE_LENGTH) metric.gauge = decodeData(reader.bytes(), 'number', false)
    else if (field === 7 && wireType === WIRE_LENGTH) metric.sum = decodeData(reader.bytes(), 'number', true)
    else if (field === 9 && wireType === WIRE_LENGTH) metric.histogram = decodeData(reader.bytes(), 'histogram', true)
    else if (field === 10 && wireType === WIRE_LENGTH) metric.exponentialHistogram = decodeData(reader.bytes(), 'exponential', true)
    else if (field === 11 && wireType === WIRE_LENGTH) metric.summary = decodeData(reader.bytes(), 'summary', false)
    else return false
    return true
  })
  return metric
}

type DecodedScopeMetrics = { scope?: DecodedScope; metrics: DecodedMetric[] }

const decodeScopeMetrics = (bytes: Uint8Array): DecodedScopeMetrics => {
  const scopeMetrics: DecodedScopeMetrics = { metrics: [] }
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) scopeMetrics.scope = decodeScope(reader.bytes())
    else if (field === 2 && wireType === WIRE_LENGTH) scopeMetrics.metrics.push(decodeMetric(reader.bytes()))
    else return false
    return true
  })
  return scopeMetrics
}

const decodeResourceMetrics = (bytes: Uint8Array) => {
  const attributes: OtlpKeyValue[] = []
  const scopeMetrics: DecodedScopeMetrics[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) attributes.push(...decodeResourceAttributes(reader.bytes()))
    else if (field === 2 && wireType === WIRE_LENGTH) scopeMetrics.push(decodeScopeMetrics(reader.bytes()))
    else return false
    return true
  })
  return { resource: { attributes }, scopeMetrics }
}

const decodeMetricsRequest = (bytes: Uint8Array): OtlpMetricsRequest => {
  const resourceMetrics: ReturnType<typeof decodeResourceMetrics>[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1) return false
    expectWire(wireType, WIRE_LENGTH)
    resourceMetrics.push(decodeResourceMetrics(reader.bytes()))
    return true
  })
  return { resourceMetrics }
}

export class OtlpProtobuf {
  static readonly decodeTraces = decodeTraceRequest
  static readonly decodeLogs = decodeLogsRequest
  static readonly decodeMetrics = decodeMetricsRequest
}
