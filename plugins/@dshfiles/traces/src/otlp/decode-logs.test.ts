import { describe, expect, test } from 'vitest'
import { OtlpBody } from './decode.js'
import { SpanNormalizer } from './normalize.js'
import { OtlpProtobuf } from './protobuf.js'
import { sdkLogsFixture } from './sdk-fixture.test-support.js'

const REDACT = { redactContent: true }

describe('OTLP log decoding', () => {
  test('decodes SDK log records from protobuf into the same records as from JSON', async () => {
    const fixture = await sdkLogsFixture()
    const fromProtobuf = SpanNormalizer.normalizeLogs(OtlpBody.decodeLogs({ body: Buffer.from(fixture.protobuf), wire: 'protobuf' }), REDACT)
    const fromJson = SpanNormalizer.normalizeLogs(OtlpBody.decodeLogs({ body: Buffer.from(JSON.stringify(fixture.json)), wire: 'json' }), REDACT)
    expect(fromProtobuf.rejected).toBe(0)
    expect(fromProtobuf.logs).toHaveLength(3)
    expect(fromProtobuf.logs).toEqual(fromJson.logs)
  })

  test('keeps severity, body, attributes, event name and the trace correlation', async () => {
    const fixture = await sdkLogsFixture()
    const [warn, failed, genAi] = SpanNormalizer.normalizeLogs(OtlpProtobuf.decodeLogs(fixture.protobuf), REDACT).logs
    expect(warn).toMatchObject({
      severityNumber: 13,
      severityText: 'WARN',
      body: 'cart is empty',
      service: 'checkout-api',
      scope: 'fixture-logger',
      traceId: fixture.traceId,
      spanId: fixture.spanId,
      attributes: { 'cart.id': 'c-42', 'retry.count': 2 },
    })
    expect(failed).toMatchObject({ severityNumber: 17, eventName: 'payment.failed', traceId: null, spanId: null })
    expect(JSON.parse(failed?.body ?? '{}')).toEqual({ reason: 'declined', code: 402 })
    expect(genAi?.body).toBe('[redacted: 15 chars]')
  })

  test('keeps GenAI event bodies when redaction is off, and rejects records without a time', async () => {
    const fixture = await sdkLogsFixture()
    const logs = SpanNormalizer.normalizeLogs(OtlpProtobuf.decodeLogs(fixture.protobuf), { redactContent: false }).logs
    expect(logs[2]?.body).toBe('user said hello')
    const result = SpanNormalizer.normalizeLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: 'no time' } }] }] }] }, REDACT)
    expect(result).toEqual({ logs: [], rejected: 1 })
  })

  test('rejects JSON that is not a logs export request', () => {
    expect(() => OtlpBody.decodeLogs({ body: Buffer.from('{"resourceLogs":"nope"}'), wire: 'json' })).toThrow(/ExportLogsServiceRequest/)
  })
})
