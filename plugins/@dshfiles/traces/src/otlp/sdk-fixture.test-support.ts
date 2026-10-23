import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'
import {
  JsonLogsSerializer,
  JsonMetricsSerializer,
  JsonTraceSerializer,
  ProtobufLogsSerializer,
  ProtobufMetricsSerializer,
  ProtobufTraceSerializer,
} from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics'
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type ReadableSpan } from '@opentelemetry/sdk-trace'

/** Spans recorded by the official OpenTelemetry JS SDK, the exporter LoongSuite uses, serialized both ways. */
const sdkFixture = async (): Promise<{ readonly spans: readonly ReadableSpan[]; readonly protobuf: Uint8Array; readonly json: unknown }> => {
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

/** Log records from the official logs SDK, correlated with a span, serialized both ways. */
const sdkLogsFixture = async (): Promise<{
  readonly traceId: string
  readonly spanId: string
  readonly protobuf: Uint8Array
  readonly json: unknown
}> => {
  const exporter = new InMemoryLogRecordExporter()
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ 'service.name': 'checkout-api' }),
    processors: [new SimpleLogRecordProcessor({ exporter })],
  })
  const tracerProvider = new TracerProvider({ resource: resourceFromAttributes({ 'service.name': 'checkout-api' }) })
  const span = tracerProvider.getTracer('fixture-scope').startSpan('GET /checkout')
  const spanContext = trace.setSpan(context.active(), span)
  const logger = provider.getLogger('fixture-logger', '1.0.0')
  logger.emit({
    severityNumber: SeverityNumber.WARN,
    severityText: 'WARN',
    body: 'cart is empty',
    attributes: { 'cart.id': 'c-42', 'retry.count': 2 },
    context: spanContext,
  })
  logger.emit({ severityNumber: SeverityNumber.ERROR, body: { reason: 'declined', code: 402 }, eventName: 'payment.failed' })
  logger.emit({ severityNumber: SeverityNumber.INFO, body: 'user said hello', eventName: 'gen_ai.user.message' })
  span.end()
  await provider.forceFlush()
  const records = exporter.getFinishedLogRecords()
  const protobuf = ProtobufLogsSerializer.serializeRequest(records)
  const json = JsonLogsSerializer.serializeRequest(records)
  if (protobuf === undefined || json === undefined) throw new Error('The SDK logs serializer returned nothing.')
  await provider.shutdown()
  return { traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, protobuf, json: JSON.parse(new TextDecoder().decode(json)) }
}

class CollectingReader extends MetricReader {
  protected override onShutdown = async (): Promise<void> => undefined
  protected override onForceFlush = async (): Promise<void> => undefined
}

/** A counter, a gauge, an up-down counter and a histogram from the official metrics SDK, serialized both ways. */
const sdkMetricsFixture = async (): Promise<{ readonly protobuf: Uint8Array; readonly json: unknown }> => {
  const reader = new CollectingReader()
  const provider = new MeterProvider({ resource: resourceFromAttributes({ 'service.name': 'checkout-api' }), readers: [reader] })
  const meter = provider.getMeter('fixture-meter', '1.0.0')
  meter.createCounter('http.requests', { unit: '{request}', description: 'Requests served' }).add(3, { route: '/a' })
  meter.createUpDownCounter('queue.depth').add(-2)
  meter.createGauge('cpu.usage', { unit: '1' }).record(0.25)
  const latency = meter.createHistogram('http.duration', { unit: 'ms' })
  latency.record(10, { route: '/a' })
  latency.record(30, { route: '/a' })
  const collected = await reader.collect()
  const protobuf = ProtobufMetricsSerializer.serializeRequest(collected.resourceMetrics)
  const json = JsonMetricsSerializer.serializeRequest(collected.resourceMetrics)
  if (protobuf === undefined || json === undefined) throw new Error('The SDK metrics serializer returned nothing.')
  await provider.shutdown()
  return { protobuf, json: JSON.parse(new TextDecoder().decode(json)) }
}

export class SdkFixtures {
  static readonly traces = sdkFixture
  static readonly logs = sdkLogsFixture
  static readonly metrics = sdkMetricsFixture
}
