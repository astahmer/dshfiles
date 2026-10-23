import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api'
import { JsonTraceSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type ReadableSpan } from '@opentelemetry/sdk-trace'

/** Spans recorded by the official OpenTelemetry JS SDK, the exporter LoongSuite uses, serialized both ways. */
export const sdkFixture = async (): Promise<{ readonly spans: readonly ReadableSpan[]; readonly protobuf: Uint8Array; readonly json: unknown }> => {
  const exporter = new InMemorySpanExporter()
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'checkout-api', 'deployment.environment': 'test' }),
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  })
  const tracer = provider.getTracer('fixture-scope', '1.2.3')
  const root = tracer.startSpan('GET /checkout', {
    kind: SpanKind.SERVER,
    attributes: {
      'http.request.method': 'GET',
      'http.response.status_code': 500,
      'sampled.ratio': 0.25,
      'feature.enabled': true,
      'tags.list': ['a', 'b'],
      'retry.counts': [1, 2, 3],
      'big.negative': -42,
      'dsh.session.id': 'session-fixture',
    },
  })
  const rootContext = trace.setSpan(context.active(), root)
  const child = tracer.startSpan('SELECT orders', { kind: SpanKind.CLIENT, attributes: { 'db.system': 'sqlite' } }, rootContext)
  child.addEvent('rows.read', { 'rows.count': 12 })
  child.recordException(Object.assign(new Error('disk I/O error 1234'), { name: 'SqliteError' }))
  child.setStatus({ code: SpanStatusCode.ERROR, message: 'disk I/O error 1234' })
  child.end()
  root.setStatus({ code: SpanStatusCode.OK })
  root.end()
  await provider.forceFlush()
  const spans = exporter.getFinishedSpans()
  const protobuf = ProtobufTraceSerializer.serializeRequest(spans)
  const json = JsonTraceSerializer.serializeRequest(spans)
  if (protobuf === undefined || json === undefined) throw new Error('The SDK serializer returned nothing.')
  await provider.shutdown()
  return { spans, protobuf, json: JSON.parse(new TextDecoder().decode(json)) }
}
