import { recordSpans } from '@dshfiles/dshx/tracing'
import { decodeJson } from '@dshfiles/dshx/json'
import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OtlpMetricsExporter } from './otel-exporter.js'
import { otlpMetricsRequestSchema, type OtlpMetricsRequest } from './otel-metrics.js'
import { openUsageStore, type UsageStore } from './store.js'

interface ReceivedExport {
  readonly path: string | undefined
  readonly headers: IncomingHttpHeaders
  readonly body: OtlpMetricsRequest
  readonly receivedAt: number
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const startCollector = async (
  respond: (index: number) => { readonly status: number; readonly headers?: Record<string, string> } | 'hang' = () => ({ status: 200 }),
) => {
  const received: ReceivedExport[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      received.push({
        path: request.url,
        headers: request.headers,
        body: decodeJson(otlpMetricsRequestSchema, Buffer.concat(chunks).toString('utf8')),
        receivedAt: Date.now(),
      })
      const reply = respond(received.length - 1)
      if (reply === 'hang') return
      response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers })
      response.end('{}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = z.object({ port: z.number().int() }).parse(server.address())
  return { received, url: `http://127.0.0.1:${String(address.port)}/v1/metrics` }
}

const openStore = (): UsageStore => {
  const store = openUsageStore(':memory:')
  cleanups.push(() => store.close())
  return store
}

const recordJev = (store: UsageStore, index: number) =>
  store.recordJevUsage({
    requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    source: 'memory',
    credential: 'PRIVATE_LABEL',
    startedAt: Date.now(),
    durationMs: 40,
    outcome: 'success',
    inputTokens: 10,
    outputTokens: 2,
  })

const jevCountOf = (request: OtlpMetricsRequest | undefined) => {
  const metric = request?.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(candidate => candidate.name === 'dsh.jev.request.count')
  return metric && 'sum' in metric ? metric.sum.dataPoints[0] : undefined
}

describe('OtlpMetricsExporter.resolve', () => {
  it('stays off without an OTLP endpoint', () => {
    expect(OtlpMetricsExporter.resolve({})).toEqual({ enabled: false, reason: 'not-configured' })
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toEqual({ enabled: false, reason: 'not-configured' })
  })

  it('appends the metrics path to the base endpoint and uses the metrics endpoint verbatim', () => {
    const base = OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' })
    expect(base).toEqual({ enabled: true, config: { url: 'http://collector:4318/v1/metrics', headers: {}, intervalMs: 60_000, timeoutMs: 10_000 } })
    const prefixed = OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/otlp' })
    expect(prefixed.enabled && prefixed.config.url).toBe('https://otlp.example/otlp/v1/metrics')
    const specific = OtlpMetricsExporter.resolve({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://ignored:4318',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://collector:9000/custom',
    })
    expect(specific.enabled && specific.config.url).toBe('http://collector:9000/custom')
  })

  it('reads interval, timeout and headers, falling back on invalid values', () => {
    const resolution = OtlpMetricsExporter.resolve({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_METRIC_EXPORT_INTERVAL: '15000',
      OTEL_EXPORTER_OTLP_TIMEOUT: '2500',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc,x-scope=one,broken',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'x-scope=two',
    })
    expect(resolution.enabled && resolution.config).toEqual({
      url: 'http://collector:4318/v1/metrics',
      headers: { authorization: 'Basic abc', 'x-scope': 'two' },
      intervalMs: 15_000,
      timeoutMs: 2_500,
    })
    const fallback = OtlpMetricsExporter.resolve({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_METRIC_EXPORT_INTERVAL: 'soon',
      OTEL_EXPORTER_OTLP_TIMEOUT: '-1',
    })
    expect(fallback.enabled && [fallback.config.intervalMs, fallback.config.timeoutMs]).toEqual([60_000, 10_000])
    const tooFast = OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_METRIC_EXPORT_INTERVAL: '5' })
    expect(tooFast.enabled && tooFast.config.intervalMs).toBe(1_000)
  })

  it('honours the SDK kill switches and refuses non-http endpoints', () => {
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_SDK_DISABLED: 'TRUE' })).toEqual({
      enabled: false,
      reason: 'disabled',
    })
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_METRICS_EXPORTER: 'none' })).toEqual({
      enabled: false,
      reason: 'disabled',
    })
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4317' })).toEqual({ enabled: false, reason: 'invalid-endpoint' })
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'not a url' })).toEqual({ enabled: false, reason: 'invalid-endpoint' })
  })

  it('falls back to the in-process receiver only without an environment endpoint, never sending env headers there', () => {
    const local = OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20k' }, { localBaseUrl: 'http://127.0.0.1:4318/' })
    expect(local).toEqual({ enabled: true, config: { url: 'http://127.0.0.1:4318/v1/metrics', headers: {}, intervalMs: 60_000, timeoutMs: 10_000 } })
    const environment = OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }, { localBaseUrl: 'http://127.0.0.1:4318' })
    expect(environment.enabled && environment.config.url).toBe('http://collector:4318/v1/metrics')
    expect(OtlpMetricsExporter.resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4317' }, { localBaseUrl: 'http://127.0.0.1:4318' })).toEqual({
      enabled: false,
      reason: 'invalid-endpoint',
    })
    expect(OtlpMetricsExporter.resolve({ OTEL_METRICS_EXPORTER: 'none' }, { localBaseUrl: 'http://127.0.0.1:4318' })).toEqual({
      enabled: false,
      reason: 'disabled',
    })
  })

  it('names the service from OTEL_SERVICE_NAME, defaulting to dshfiles', () => {
    expect(OtlpMetricsExporter.serviceName({})).toBe('dshfiles')
    expect(OtlpMetricsExporter.serviceName({ OTEL_SERVICE_NAME: 'laptop-dsh' })).toBe('laptop-dsh')
  })
})

describe('OtlpMetricsExporter.start', () => {
  it('posts cumulative OTLP/JSON with a stable start time so a backend can diff exports', async () => {
    const collector = await startCollector()
    const store = openStore()
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 25, timeoutMs: 1_000 },
      destination: () => ({ url: collector.url, headers: { authorization: 'Bearer token' } }),
      collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    cleanups.push(() => exporter.stop())
    recordJev(store, 1)
    await vi.waitFor(() => expect(collector.received.length).toBeGreaterThanOrEqual(1), { timeout: 2_000 })
    recordJev(store, 2)
    await vi.waitFor(() => expect(jevCountOf(collector.received.at(-1)?.body)?.asInt).toBe('2'), { timeout: 2_000 })

    const first = collector.received[0]
    const last = collector.received.at(-1)
    expect(first?.path).toBe('/v1/metrics')
    expect(first?.headers['content-type']).toBe('application/json')
    expect(first?.headers.authorization).toBe('Bearer token')
    const firstPoint = jevCountOf(first?.body)
    const lastPoint = jevCountOf(last?.body)
    expect(firstPoint?.asInt).toBe('1')
    expect(lastPoint?.startTimeUnixNano).toBe(firstPoint?.startTimeUnixNano)
    expect(lastPoint?.startTimeUnixNano).toBe((BigInt(exporter.state().startedAt) * 1_000_000n).toString())
    expect(BigInt(lastPoint?.timeUnixNano ?? '0')).toBeGreaterThan(BigInt(firstPoint?.timeUnixNano ?? '0'))
    const body = last?.body
    expect(body?.resourceMetrics[0]?.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'dshfiles' } }])
    expect(
      body?.resourceMetrics[0]?.scopeMetrics[0]?.metrics.map(metric =>
        'sum' in metric ? metric.sum.aggregationTemporality : metric.histogram.aggregationTemporality,
      ),
    ).toEqual(expect.arrayContaining([2]))
    expect(JSON.stringify(body)).not.toContain('PRIVATE_LABEL')
    expect(exporter.state()).toEqual(expect.objectContaining({ consecutiveFailures: 0, lastError: null }))
  })

  it('records a usage metrics export span with the collector host and status', async () => {
    const collector = await startCollector()
    const store = openStore()
    using recorder = recordSpans()
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 25, timeoutMs: 1_000 },
      destination: () => ({ url: collector.url, headers: { authorization: 'Bearer token' } }),
      collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    cleanups.push(() => exporter.stop())
    recordJev(store, 1)
    await vi.waitFor(() => expect(recorder.named('usage metrics export').length).toBeGreaterThanOrEqual(1), { timeout: 2_000 })
    const span = recorder.span('usage metrics export')
    expect(span.attributes).toEqual({ 'server.address': new URL(collector.url).host, 'http.response.status_code': 200 })
  })

  it('skips the POST while there is nothing to report', async () => {
    const collector = await startCollector()
    const store = openStore()
    let collected = 0
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 10, timeoutMs: 1_000 },
      destination: () => ({ url: collector.url, headers: {} }),
      collect: range => {
        collected += 1
        return store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' })
      },
    })
    await vi.waitFor(() => expect(collected).toBeGreaterThanOrEqual(3), { timeout: 2_000 })
    await exporter.stop()
    expect(collector.received).toEqual([])
  })

  it('sends nothing until a destination appears, then exports to it', async () => {
    const collector = await startCollector()
    const store = openStore()
    let url: string | undefined
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 10, timeoutMs: 1_000 },
      destination: () => (url === undefined ? undefined : { url, headers: {} }),
      collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    cleanups.push(() => exporter.stop())
    recordJev(store, 1)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(collector.received).toEqual([])
    expect(exporter.state().consecutiveFailures).toBe(0)
    url = collector.url
    await vi.waitFor(() => expect(collector.received.length).toBeGreaterThanOrEqual(1), { timeout: 2_000 })
  })

  it('backs off exponentially on failure and resumes the interval after recovery', async () => {
    const collector = await startCollector(index => (index < 2 ? { status: 503 } : { status: 200 }))
    const store = openStore()
    const failures: { readonly message: string; readonly consecutiveFailures: number }[] = []
    let recoveries = 0
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 20, timeoutMs: 1_000 },
      destination: () => ({ url: collector.url, headers: {} }),
      collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' }),
      onFailure: failure => {
        failures.push(failure)
        throw new Error('a throwing listener must not break the exporter')
      },
      onRecovery: () => {
        recoveries += 1
      },
    })
    cleanups.push(() => exporter.stop())
    recordJev(store, 1)
    await vi.waitFor(() => expect(failures).toHaveLength(1), { timeout: 2_000 })
    expect(exporter.state()).toEqual(expect.objectContaining({ consecutiveFailures: 1, nextDelayMs: 40, lastError: 'HTTP 503' }))
    await vi.waitFor(() => expect(failures).toHaveLength(2), { timeout: 2_000 })
    expect(exporter.state().nextDelayMs).toBe(80)
    await vi.waitFor(() => expect(recoveries).toBe(1), { timeout: 2_000 })
    expect(exporter.state()).toEqual(expect.objectContaining({ consecutiveFailures: 0, nextDelayMs: 20, lastError: null }))
    expect(exporter.state().exports).toBeGreaterThanOrEqual(1)
    const [first, second, third] = collector.received
    expect((second?.receivedAt ?? 0) - (first?.receivedAt ?? 0)).toBeGreaterThanOrEqual(35)
    expect((third?.receivedAt ?? 0) - (second?.receivedAt ?? 0)).toBeGreaterThanOrEqual(75)
    expect(failures.map(failure => failure.consecutiveFailures)).toEqual([1, 2])
  })

  it('waits at least as long as a Retry-After answer asks', async () => {
    const collector = await startCollector(() => ({ status: 429, headers: { 'retry-after': '3' } }))
    const store = openStore()
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 20, timeoutMs: 1_000 },
      destination: () => ({ url: collector.url, headers: {} }),
      collect: range => store.otelMetrics({ ...range, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    cleanups.push(() => exporter.stop())
    recordJev(store, 1)
    await vi.waitFor(() => expect(exporter.state().consecutiveFailures).toBe(1), { timeout: 2_000 })
    expect(exporter.state()).toEqual(expect.objectContaining({ nextDelayMs: 3_000, lastError: 'HTTP 429' }))
  })

  it('never throws when the collector is unreachable and stops scheduling once stopped', async () => {
    const collector = await startCollector()
    const unreachable = collector.url.replace(/:\d+\//u, ':1/')
    const store = openStore()
    recordJev(store, 1)
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 10, timeoutMs: 1_000 },
      destination: () => ({ url: unreachable, headers: {} }),
      collect: range => store.otelMetrics({ from: range.from - 60_000, to: range.to, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    await vi.waitFor(() => expect(exporter.state().consecutiveFailures).toBeGreaterThanOrEqual(1), { timeout: 2_000 })
    expect(exporter.state().lastError).toMatch(/fetch failed/u)
    await exporter.stop()
    const failuresAtStop = exporter.state().consecutiveFailures
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(exporter.state().consecutiveFailures).toBe(failuresAtStop)
  })

  it('aborts a hanging export on stop', async () => {
    const collector = await startCollector(() => 'hang')
    const store = openStore()
    recordJev(store, 1)
    const exporter = OtlpMetricsExporter.start({
      timing: { intervalMs: 10, timeoutMs: 60_000 },
      destination: () => ({ url: collector.url, headers: {} }),
      collect: range => store.otelMetrics({ from: range.from - 60_000, to: range.to, temporality: 'cumulative', serviceName: 'dshfiles' }),
    })
    await vi.waitFor(() => expect(collector.received).toHaveLength(1), { timeout: 2_000 })
    const stoppedAt = Date.now()
    await exporter.stop()
    expect(Date.now() - stoppedAt).toBeLessThan(1_000)
    expect(exporter.state().exports).toBe(0)
  })
})
