import { describe, expect, test } from 'vitest'
import { OtlpBody } from './decode.js'
import { SpanNormalizer } from './normalize.js'
import { SdkFixtures } from './sdk-fixture.test-support.js'

const REDACT = { redactContent: true }

describe('OTLP metric decoding', () => {
  test('decodes SDK metrics from protobuf into the same points as from JSON', async () => {
    const fixture = await SdkFixtures.metrics()
    const fromProtobuf = SpanNormalizer.normalizeMetrics(OtlpBody.decodeMetrics({ body: Buffer.from(fixture.protobuf), wire: 'protobuf' }), REDACT)
    const fromJson = SpanNormalizer.normalizeMetrics(OtlpBody.decodeMetrics({ body: Buffer.from(JSON.stringify(fixture.json)), wire: 'json' }), REDACT)
    expect(fromProtobuf.rejected).toBe(0)
    expect(fromProtobuf.points).toHaveLength(4)
    expect(fromProtobuf.points).toEqual(fromJson.points)
  })

  test('keeps the metric type, temporality, value and attributes', async () => {
    const fixture = await SdkFixtures.metrics()
    const byName = new Map(
      SpanNormalizer.normalizeMetrics(OtlpBody.decodeMetrics({ body: Buffer.from(fixture.protobuf), wire: 'protobuf' }), REDACT).points.map(point => [
        point.name,
        point,
      ]),
    )
    expect(byName.get('http.requests')).toMatchObject({
      type: 'sum',
      monotonic: true,
      temporality: 'cumulative',
      unit: '{request}',
      description: 'Requests served',
      service: 'checkout-api',
      scope: 'fixture-meter',
      value: 3,
      attributes: { route: '/a' },
    })
    expect(byName.get('queue.depth')).toMatchObject({ type: 'sum', monotonic: false, value: -2 })
    expect(byName.get('cpu.usage')).toMatchObject({ type: 'gauge', value: 0.25 })
    expect(byName.get('http.duration')).toMatchObject({ type: 'histogram', count: 2, sum: 40, value: 20, min: 10, max: 30 })
  })

  test('rejects metrics without data or time, and JSON that is not a metrics export', () => {
    const result = SpanNormalizer.normalizeMetrics(
      { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'empty' }, { name: 'untimed', gauge: { dataPoints: [{ asDouble: 1 }] } }] }] }] },
      REDACT,
    )
    expect(result).toEqual({ points: [], rejected: 2 })
    expect(() => OtlpBody.decodeMetrics({ body: Buffer.from('{"resourceMetrics":1}'), wire: 'json' })).toThrow(/ExportMetricsServiceRequest/)
  })
})
