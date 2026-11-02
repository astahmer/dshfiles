import { createServer, type IncomingHttpHeaders } from 'node:http'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Exit, Fiber, Layer, Option, Queue, Ref, Schema, Scope } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'
import { OtlpExporter, OtlpMetricsExporter } from './otel-exporter.js'
import { otlpMetricsRequestSchema, type OtlpMetricsRequest } from './otel-metrics.js'
import { UsageRepo } from './store.js'
import { usageRepoTest } from './test-layers.js'

interface ReceivedExport {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: OtlpMetricsRequest
  readonly signal: AbortSignal
}

const INTERVAL_MS = 20
const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(otlpMetricsRequestSchema))
const COLLECTOR_URL = 'http://collector.test:4318/v1/metrics'

type Reply = { readonly status: number; readonly headers?: Record<string, string> } | 'hang' | 'unreachable'

/** The OTLP collector is an external system: it answers each export with the scripted reply and queues what it received. */
const collectorTest = (respond: (index: number) => Reply = () => ({ status: 200 })) =>
  Effect.gen(function* () {
    const received = yield* Queue.unbounded<ReceivedExport>()
    const count = yield* Ref.make(0)
    const client = HttpClient.make((request, url, signal) =>
      Effect.gen(function* () {
        const index = yield* Ref.getAndUpdate(count, current => current + 1)
        const text = request.body._tag === 'Uint8Array' ? (request.body.text ?? new TextDecoder().decode(request.body.body)) : ''
        yield* Queue.offer(received, { url: url.toString(), headers: request.headers, body: decodeBody(text), signal })
        const reply = respond(index)
        if (reply === 'hang') return yield* Effect.never
        if (reply === 'unreachable')
          return yield* new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description: 'connect ECONNREFUSED' }) })
        return HttpClientResponse.fromWeb(request, new Response('{}', { status: reply.status, headers: reply.headers ?? {} }))
      }),
    )
    return { received, layer: Layer.succeed(HttpClient.HttpClient, client) }
  })

const recordJev = (index: number) =>
  UsageRepo.use(repo =>
    repo.recordJevUsage({
      requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      source: 'memory',
      credential: 'PRIVATE_LABEL',
      startedAt: index,
      durationMs: 40,
      outcome: 'success',
      inputTokens: 10,
      outputTokens: 2,
    }),
  )

const jevCountOf = (request: OtlpMetricsRequest | undefined) => {
  const metric = request?.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(candidate => candidate.name === 'dsh.jev.request.count')
  return metric && 'sum' in metric ? metric.sum.dataPoints[0] : undefined
}

/** Start an exporter in its own scope over the repo in context, so a test can stop it like the plugin's unload does. */
const startExporter = (input: {
  readonly http: Layer.Layer<HttpClient.HttpClient>
  readonly destination?: Effect.Effect<Option.Option<{ readonly url: string; readonly headers: Readonly<Record<string, string>> }>>
}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(
      OtlpExporter.layer({
        timing: { intervalMs: INTERVAL_MS, timeoutMs: 60_000 },
        serviceName: 'dshfiles',
        destination: input.destination ?? Effect.succeed(Option.some({ url: COLLECTOR_URL, headers: { authorization: 'Bearer token' } })),
      }).pipe(Layer.provide(input.http)),
      scope,
    )
    return { exporter: Context.get(context, OtlpExporter), stop: Scope.close(scope, Exit.void) }
  })

const advance = (millis: number) => Effect.andThen(TestClock.adjust(millis), Effect.yieldNow)

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

describe('OtlpExporter', () => {
  it.effect('posts cumulative OTLP/JSON with a stable start time so a backend can diff exports', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest()
      const { exporter } = yield* startExporter({ http: collector.layer })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      const first = yield* Queue.take(collector.received)
      yield* recordJev(2)
      yield* advance(INTERVAL_MS)
      const last = yield* Queue.take(collector.received)

      expect(first.url).toBe(COLLECTOR_URL)
      expect(first.headers['content-type']).toBe('application/json')
      expect(first.headers.authorization).toBe('Bearer token')
      expect(jevCountOf(first.body)?.asInt).toBe('1')
      expect(jevCountOf(last.body)?.asInt).toBe('2')
      expect(jevCountOf(last.body)?.startTimeUnixNano).toBe(jevCountOf(first.body)?.startTimeUnixNano)
      expect(jevCountOf(last.body)?.startTimeUnixNano).toBe((BigInt((yield* exporter.state).startedAt) * 1_000_000n).toString())
      expect(BigInt(jevCountOf(last.body)?.timeUnixNano ?? '0')).toBeGreaterThan(BigInt(jevCountOf(first.body)?.timeUnixNano ?? '0'))
      expect(last.body.resourceMetrics[0]?.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'dshfiles' } }])
      expect(
        last.body.resourceMetrics[0]?.scopeMetrics[0]?.metrics.map(metric =>
          'sum' in metric ? metric.sum.aggregationTemporality : metric.histogram.aggregationTemporality,
        ),
      ).toEqual(expect.arrayContaining([2]))
      expect(JSON.stringify(last.body)).not.toContain('PRIVATE_LABEL')
      expect(yield* exporter.state).toMatchObject({ exports: 2, consecutiveFailures: 0, lastError: null })
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('retains the custom export span through the Effect loop', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(Effect.sync(recordSpans), spans => Effect.sync(() => spans.stop()))
      const collector = yield* collectorTest()
      yield* startExporter({ http: collector.layer }).pipe(Effect.provide(tracerLayer))
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect(recorder.span('usage metrics export').attributes).toEqual({ 'server.address': 'collector.test:4318', 'http.response.status_code': 200 })
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('skips the POST while there is nothing to report', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest()
      yield* startExporter({ http: collector.layer })
      yield* advance(INTERVAL_MS * 5)
      expect(yield* Queue.size(collector.received)).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('sends nothing until a destination appears, then exports to it', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest()
      const destination = yield* Ref.make(Option.none<{ readonly url: string; readonly headers: Readonly<Record<string, string>> }>())
      const { exporter } = yield* startExporter({ http: collector.layer, destination: Ref.get(destination) })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS * 3)
      expect(yield* Queue.size(collector.received)).toBe(0)
      expect((yield* exporter.state).consecutiveFailures).toBe(0)
      yield* Ref.set(destination, Option.some({ url: COLLECTOR_URL, headers: {} }))
      yield* advance(INTERVAL_MS)
      expect((yield* Queue.take(collector.received)).url).toBe(COLLECTOR_URL)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('backs off exponentially on failure and resumes the interval after recovery', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest(index => (index < 2 ? { status: 503 } : { status: 200 }))
      const { exporter } = yield* startExporter({ http: collector.layer })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect(yield* exporter.state).toMatchObject({ consecutiveFailures: 1, lastError: 'HTTP 503' })

      yield* advance(INTERVAL_MS * 2 - 1)
      expect(yield* Queue.size(collector.received)).toBe(0)
      yield* advance(1)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect((yield* exporter.state).consecutiveFailures).toBe(2)

      yield* advance(INTERVAL_MS * 4 - 1)
      expect(yield* Queue.size(collector.received)).toBe(0)
      yield* advance(1)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect(yield* exporter.state).toMatchObject({ exports: 1, consecutiveFailures: 0, lastError: null })

      yield* advance(INTERVAL_MS)
      yield* Queue.take(collector.received)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('waits at least as long as a Retry-After answer asks', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest(() => ({ status: 429, headers: { 'retry-after': '3' } }))
      const { exporter } = yield* startExporter({ http: collector.layer })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect(yield* exporter.state).toMatchObject({ consecutiveFailures: 1, lastError: 'HTTP 429' })
      yield* advance(2_999)
      expect(yield* Queue.size(collector.received)).toBe(0)
      yield* advance(1)
      yield* Queue.take(collector.received)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('never fails when the collector is unreachable and stops scheduling once stopped', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest(() => 'unreachable')
      const { exporter, stop } = yield* startExporter({ http: collector.layer })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      yield* Queue.take(collector.received)
      yield* Effect.yieldNow
      expect((yield* exporter.state).consecutiveFailures).toBe(1)
      expect((yield* exporter.state).lastError).toMatch(/ECONNREFUSED/u)
      yield* stop
      yield* advance(60 * 60_000)
      expect(yield* Queue.size(collector.received)).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('interrupts a hanging export when its scope closes', () =>
    Effect.gen(function* () {
      const collector = yield* collectorTest(() => 'hang')
      const { exporter, stop } = yield* startExporter({ http: collector.layer })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      const hanging = yield* Queue.take(collector.received)
      expect(hanging.signal.aborted).toBe(false)
      const stopping = yield* Effect.forkChild(stop)
      yield* Fiber.join(stopping)
      expect(hanging.signal.aborted).toBe(true)
      expect((yield* exporter.state).exports).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('posts OTLP/JSON over real HTTP to a local collector', () =>
    Effect.gen(function* () {
      const received = yield* Queue.unbounded<{ readonly path: string | undefined; readonly headers: IncomingHttpHeaders; readonly body: string }>()
      const server = yield* Effect.acquireRelease(
        Effect.callback<ReturnType<typeof createServer>>(resume => {
          const listening = createServer((request, response) => {
            const chunks: Buffer[] = []
            request.on('data', (chunk: Buffer) => chunks.push(chunk))
            request.on('end', () => {
              Queue.offerUnsafe(received, { path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
              response.writeHead(200, { 'content-type': 'application/json' })
              response.end('{}')
            })
          })
          listening.listen(0, '127.0.0.1', () => resume(Effect.succeed(listening)))
        }),
        listening => Effect.sync(() => listening.close()),
      )
      const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
      const url = `http://127.0.0.1:${String(address.port)}/v1/metrics`
      yield* startExporter({ http: FetchHttpClient.layer, destination: Effect.succeed(Option.some({ url, headers: { authorization: 'Bearer token' } })) })
      yield* recordJev(1)
      yield* advance(INTERVAL_MS)
      const request = yield* Queue.take(received)
      expect(request.path).toBe('/v1/metrics')
      expect(request.headers['content-type']).toBe('application/json')
      expect(request.headers.authorization).toBe('Bearer token')
      expect(jevCountOf(decodeBody(request.body))?.asInt).toBe('1')
    }).pipe(Effect.provide(usageRepoTest())),
  )
})
