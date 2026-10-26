import { describe, expect, test } from 'vitest'
import { OtlpBody } from './decode.js'
import { otlpTraceRequestSchema, type OtlpSpan } from './json-schema.js'
import { SPAN_BOUNDS, SpanNormalizer } from './normalize.js'
import { OtlpProtobuf, ProtobufDecodeError } from './protobuf.js'
import { SdkFixtures } from './sdk-fixture.test-support.js'

const REDACT = { redactContent: true }

const byName = <Span extends { readonly name: string }>(spans: readonly Span[]) => new Map(spans.map(span => [span.name, span]))

describe('OTLP trace decoding', () => {
  test('decodes a protobuf body from the official SDK serializer into the same spans as its JSON body', async () => {
    const fixture = await SdkFixtures.traces()
    const fromProtobuf = SpanNormalizer.normalizeTraces(OtlpBody.decodeTraces({ body: Buffer.from(fixture.protobuf), wire: 'protobuf' }), REDACT)
    const fromJson = SpanNormalizer.normalizeTraces(OtlpBody.decodeTraces({ body: Buffer.from(JSON.stringify(fixture.json)), wire: 'json' }), REDACT)
    expect(fromProtobuf.rejected).toBe(0)
    expect(fromProtobuf.spans).toHaveLength(2)
    expect(fromProtobuf.spans).toEqual(fromJson.spans)
  })

  test('keeps ids, times, kinds, status, every attribute type, events and resource from the SDK', async () => {
    const fixture = await SdkFixtures.traces()
    const spans = byName(SpanNormalizer.normalizeTraces(OtlpProtobuf.decodeTraces(fixture.protobuf), REDACT).spans)
    const sdkRoot = fixture.spans.find(span => span.name === 'GET /checkout')
    const root = spans.get('GET /checkout')
    const child = spans.get('SELECT orders')
    expect(root?.traceId).toBe(sdkRoot?.spanContext().traceId)
    expect(root?.spanId).toBe(sdkRoot?.spanContext().spanId)
    expect(root?.parentSpanId).toBeNull()
    expect(child?.parentSpanId).toBe(root?.spanId)
    expect(root?.service).toBe('checkout-api')
    expect(root?.scope).toBe('fixture-scope')
    expect(root?.resource['deployment.environment']).toBe('test')
    expect(root?.kind).toBe(2)
    expect(child?.kind).toBe(3)
    expect(root?.statusCode).toBe(1)
    expect(child?.statusCode).toBe(2)
    expect(child?.statusMessage).toBe('disk I/O error 1234')
    expect(root?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.response.status_code': 500,
      'sampled.ratio': 0.25,
      'feature.enabled': true,
      'tags.list': ['a', 'b'],
      'retry.counts': [1, 2, 3],
      'big.negative': -42,
    })
    expect(root?.sessionId).toBe('session-fixture')
    expect(child?.events.map(event => event.name)).toEqual(['rows.read', 'exception'])
    expect(child?.events[1]?.attributes['exception.type']).toBe('SqliteError')
    const [startSeconds, startNanos] = sdkRoot?.startTime ?? [0, 0]
    expect(root?.startUs).toBe(startSeconds * 1_000_000 + Math.floor(startNanos / 1000))
    expect(root?.endUs).toBeGreaterThanOrEqual(root?.startUs ?? 0)
  })

  test('rejects a truncated protobuf body', async () => {
    const fixture = await SdkFixtures.traces()
    expect(() => OtlpProtobuf.decodeTraces(fixture.protobuf.subarray(0, fixture.protobuf.length - 7))).toThrow(ProtobufDecodeError)
    expect(() => OtlpBody.decodeTraces({ body: Buffer.from(fixture.protobuf.subarray(0, 20)), wire: 'protobuf' })).toThrow(/Truncated|wire type|varint/)
  })

  test('skips unknown protobuf fields', () => {
    // field 15 (varint 1) is unknown at the request level; field 1 is an empty ResourceSpans.
    const body = Uint8Array.from([0x78, 0x01, 0x0a, 0x00])
    expect(OtlpProtobuf.decodeTraces(body)).toEqual({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [] }] })
  })

  test('skips unknown length-delimited fields past their own length prefix', () => {
    // Request field 9 (length 2, unknown) precedes an empty ResourceSpans; a skip that forgets the prefix misreads it.
    const body = Uint8Array.from([0x4a, 0x02, 0x08, 0x01, 0x0a, 0x00])
    expect(OtlpProtobuf.decodeTraces(body)).toEqual({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [] }] })
  })

  test('rejects JSON that is not an export request', () => {
    expect(() => OtlpBody.decodeTraces({ body: Buffer.from('{not json'), wire: 'json' })).toThrow(/could not be parsed/)
    expect(() => OtlpBody.decodeTraces({ body: Buffer.from('{"resourceSpans":"nope"}'), wire: 'json' })).toThrow(/not an OTLP/)
  })
})

const jsonRequest = (span: OtlpSpan) =>
  otlpTraceRequestSchema.parse({
    resourceSpans: [
      { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] }, scopeSpans: [{ scope: { name: 'scope' }, spans: [span] }] },
    ],
  })

const baseSpan = {
  traceId: '0af7651916cd43dd8448eb211c80319c',
  spanId: 'b7ad6b7169203331',
  name: 'op',
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000000005000000',
}

describe('span normalization', () => {
  test('replaces content attributes with their size, also on events', () => {
    const { spans } = SpanNormalizer.normalizeTraces(
      jsonRequest({
        ...baseSpan,
        attributes: [
          { key: 'gen_ai.input.messages', value: { stringValue: 'secret prompt text' } },
          { key: 'gen_ai.prompt.0.content', value: { stringValue: 'legacy prompt' } },
          { key: 'gen_ai.request.model', value: { stringValue: 'model-x' } },
        ],
        events: [
          { name: 'gen_ai.choice', timeUnixNano: '1700000000001000000', attributes: [{ key: 'gen_ai.output.messages', value: { stringValue: 'reply' } }] },
        ],
      }),
      REDACT,
    )
    const span = spans[0]
    expect(span?.attributes).toEqual({
      'gen_ai.input.messages': '[redacted: 18 chars]',
      'gen_ai.prompt.0.content': '[redacted: 13 chars]',
      'gen_ai.request.model': 'model-x',
    })
    expect(span?.events[0]?.attributes['gen_ai.output.messages']).toBe('[redacted: 5 chars]')
    expect(JSON.stringify(spans)).not.toContain('secret prompt text')
  })

  test('keeps content attributes as sent when redaction is turned off', () => {
    const { spans } = SpanNormalizer.normalizeTraces(
      jsonRequest({ ...baseSpan, attributes: [{ key: 'gen_ai.input.messages', value: { stringValue: 'hello' } }] }),
      {
        redactContent: false,
      },
    )
    expect(spans[0]?.attributes['gen_ai.input.messages']).toBe('hello')
  })

  test('bounds names, attribute counts, string values and events', () => {
    const { spans } = SpanNormalizer.normalizeTraces(
      jsonRequest({
        ...baseSpan,
        name: 'n'.repeat(1_000),
        attributes: Array.from({ length: 300 }, (_, index) => ({ key: `k${String(index)}`, value: { stringValue: 'v'.repeat(10_000) } })),
        events: Array.from({ length: 100 }, (_, index) => ({ name: `e${String(index)}`, timeUnixNano: '1700000000001000000' })),
      }),
      REDACT,
    )
    const span = spans[0]
    expect(span?.name).toHaveLength(SPAN_BOUNDS.name)
    expect(Object.keys(span?.attributes ?? {})).toHaveLength(SPAN_BOUNDS.attributes)
    expect(String(span?.attributes['k0'])).toHaveLength(SPAN_BOUNDS.stringValue)
    expect(span?.events).toHaveLength(SPAN_BOUNDS.events)
  })

  test('accepts base64 ids, string enums and a missing service, and rejects spans without valid ids or start', () => {
    const result = SpanNormalizer.normalizeTraces(
      otlpTraceRequestSchema.parse({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: Buffer.from('0af7651916cd43dd8448eb211c80319c', 'hex').toString('base64'),
                    spanId: Buffer.from('b7ad6b7169203331', 'hex').toString('base64'),
                    name: 'b64',
                    kind: 'SPAN_KIND_CLIENT',
                    startTimeUnixNano: 1_700_000_000_000_000,
                    status: { code: 'STATUS_CODE_ERROR' },
                  },
                  { ...baseSpan, traceId: 'xyz' },
                  { ...baseSpan, spanId: '0000000000000000' },
                  { ...baseSpan, startTimeUnixNano: undefined },
                ],
              },
            ],
          },
        ],
      }),
      REDACT,
    )
    expect(result.rejected).toBe(3)
    expect(result.spans[0]).toMatchObject({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      kind: 3,
      statusCode: 2,
      service: 'unknown_service',
    })
  })

  test('drops the traces API’s own dispatch spans', () => {
    const result = SpanNormalizer.normalizeTraces(jsonRequest({ ...baseSpan, attributes: [{ key: 'dshx.api.id', value: { stringValue: 'traces' } }] }), REDACT)
    expect(result).toMatchObject({ spans: [], skippedSelf: 1 })
  })
})
