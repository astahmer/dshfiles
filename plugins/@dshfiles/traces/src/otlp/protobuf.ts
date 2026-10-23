import type { OtlpAnyValue, OtlpKeyValue, OtlpTraceRequest } from './json-schema.js'

/**
 * A minimal decoder for `opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest` (opentelemetry-proto v1.x
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
      } else if (wireType === WIRE_LENGTH) position += length()
      else if (wireType === WIRE_FIXED32) {
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

const decodeResourceSpans = (bytes: Uint8Array) => {
  const attributes: OtlpKeyValue[] = []
  const scopeSpans: DecodedScopeSpans[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field === 1 && wireType === WIRE_LENGTH) {
      readMessage(reader.bytes(), (resourceReader, resourceField, resourceWire) => {
        if (resourceField !== 1 || resourceWire !== WIRE_LENGTH) return false
        attributes.push(decodeKeyValue(resourceReader.bytes()))
        return true
      })
    } else if (field === 2 && wireType === WIRE_LENGTH) scopeSpans.push(decodeScopeSpans(reader.bytes()))
    else return false
    return true
  })
  return { resource: { attributes }, scopeSpans }
}

export const decodeTraceRequestProtobuf = (bytes: Uint8Array): OtlpTraceRequest => {
  const resourceSpans: ReturnType<typeof decodeResourceSpans>[] = []
  readMessage(bytes, (reader, field, wireType) => {
    if (field !== 1) return false
    expectWire(wireType, WIRE_LENGTH)
    resourceSpans.push(decodeResourceSpans(reader.bytes()))
    return true
  })
  return { resourceSpans }
}
