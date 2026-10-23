import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApi, method } from '../src/api/index.js'
import { registerApi } from '../src/api/host-runtime.js'
import { ApiProtocolModel } from '../src/api/common.js'
import { commandAttributes } from '../src/tracing/index.js'
import { OtlpTraceExport, type FinishedSpan } from '../src/tracing/otlp-exporter.js'
import { TracerModel, type Tracer } from '../src/tracing/tracer.js'

const ENDPOINT_ENV = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318/' }

type ExportedValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly arrayValue: { readonly values: readonly ExportedValue[] } }

const anyValueSchema: z.ZodType<ExportedValue> = z.lazy(() =>
  z.union([
    z.strictObject({ stringValue: z.string() }),
    z.strictObject({ boolValue: z.boolean() }),
    z.strictObject({ intValue: z.string().regex(/^-?\d+$/u) }),
    z.strictObject({ doubleValue: z.number() }),
    z.strictObject({ arrayValue: z.strictObject({ values: z.array(anyValueSchema) }) }),
  ]),
)
const keyValueSchema = z.strictObject({ key: z.string(), value: anyValueSchema })
const spanSchema = z.strictObject({
  traceId: z.string().regex(/^[0-9a-f]{32}$/u),
  spanId: z.string().regex(/^[0-9a-f]{16}$/u),
  parentSpanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/u)
    .optional(),
  name: z.string(),
  kind: z.number().int().min(1).max(5),
  startTimeUnixNano: z.string().regex(/^\d{19}$/u),
  endTimeUnixNano: z.string().regex(/^\d{19}$/u),
  attributes: z.array(keyValueSchema),
  status: z.strictObject({ code: z.union([z.literal(0), z.literal(1), z.literal(2)]), message: z.string().optional() }),
})
/** ExportTraceServiceRequest in the OTLP/HTTP JSON encoding. */
const exportRequestSchema = z.strictObject({
  resourceSpans: z.array(
    z.strictObject({
      resource: z.strictObject({ attributes: z.array(keyValueSchema) }),
      scopeSpans: z.array(z.strictObject({ scope: z.strictObject({ name: z.string(), version: z.string() }), spans: z.array(spanSchema) })),
    }),
  ),
})
type ExportedSpan = z.infer<typeof spanSchema>

const collector = (statuses: readonly number[] = []) => {
  const requests: { readonly url: string; readonly headers: Headers; readonly body: string }[] = []
  const pending = [...statuses]
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) })
    return new Response('{}', { status: pending.shift() ?? 200 })
  }
  const spans = (): ExportedSpan[] =>
    requests.flatMap(request =>
      exportRequestSchema.parse(JSON.parse(request.body)).resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)),
    )
  return { fetch, requests, spans }
}

const attribute = (span: ExportedSpan, key: string): ExportedValue | undefined => span.attributes.find(item => item.key === key)?.value

const finishedSpan = (name: string): FinishedSpan => ({
  traceId: '0af7651916cd43dd8448eb211c80319c',
  spanId: 'b7ad6b7169203331',
  parentSpanId: undefined,
  name,
  kind: 'internal',
  startTimeUnixNano: 1_700_000_000_000_000_000n,
  endTimeUnixNano: 1_700_000_000_500_000_000n,
  attributes: new Map(),
  status: { code: 'unset', message: undefined },
})

describe('OTLP export configuration', () => {
  it('stays off without an endpoint, when disabled, or for a non-HTTP endpoint', () => {
    expect(OtlpTraceExport.configFrom({})).toBeUndefined()
    expect(OtlpTraceExport.configFrom({ ...ENDPOINT_ENV, OTEL_SDK_DISABLED: 'true' })).toBeUndefined()
    expect(OtlpTraceExport.configFrom({ OTEL_EXPORTER_OTLP_ENDPOINT: 'file:///tmp/x' })).toBeUndefined()
    expect(OtlpTraceExport.configFrom({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' })).toBeUndefined()
  })

  it('appends /v1/traces to the base endpoint and uses the traces endpoint as given', () => {
    expect(OtlpTraceExport.configFrom(ENDPOINT_ENV)?.url).toBe('http://collector.test:4318/v1/traces')
    expect(OtlpTraceExport.configFrom({ ...ENDPOINT_ENV, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://traces.test/custom/path' })?.url).toBe(
      'https://traces.test/custom/path',
    )
  })

  it('defaults the service name to dshfiles and reads headers, signal-specific ones winning', () => {
    const config = OtlpTraceExport.configFrom({
      ...ENDPOINT_ENV,
      OTEL_EXPORTER_OTLP_HEADERS: 'x-team=a,authorization=Basic%20abc,content-type=text/plain',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-team=b',
    })
    expect(config?.serviceName).toBe('dshfiles')
    expect(Object.fromEntries(config?.headers ?? [])).toEqual({ 'x-team': 'b', authorization: 'Basic abc' })
    expect(OtlpTraceExport.configFrom({ ...ENDPOINT_ENV, OTEL_SERVICE_NAME: 'dsh-web' })?.serviceName).toBe('dsh-web')
  })
})

describe('disabled tracing', () => {
  it('hands out one no-op span, runs the callback and never sends', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: {}, fetch: sink.fetch })
    expect(tracer.enabled).toBe(false)
    const span = tracer.startSpan('ignored', { attributes: { secret: 'value' } })
    expect(span).toBe(TracerModel.noopSpan)
    expect(span.recording).toBe(false)
    await expect(tracer.withSpan('outer', {}, async inner => (inner === TracerModel.noopSpan ? 'ran' : 'wrong'))).resolves.toBe('ran')
    expect(tracer.traceparent()).toBeUndefined()
    await tracer.flush()
    expect(sink.requests).toHaveLength(0)
  })
})

describe('OTLP/HTTP JSON payload', () => {
  it('encodes spans as the specification requires', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: { ...ENDPOINT_ENV, OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=k' }, fetch: sink.fetch })
    await tracer.withSpan('outer', { kind: 'server', attributes: { count: 3, ratio: 0.5, ok: true, words: ['a', 'b'], skipped: undefined } }, async span => {
      span.setStatus('error', 'boom')
    })
    await tracer.flush()

    expect(sink.requests).toHaveLength(1)
    const [request] = sink.requests
    expect(request?.url).toBe('http://collector.test:4318/v1/traces')
    expect(request?.headers.get('content-type')).toBe('application/json')
    expect(request?.headers.get('x-api-key')).toBe('k')
    const body = exportRequestSchema.parse(JSON.parse(request?.body ?? ''))
    const resource = body.resourceSpans[0]
    expect(resource?.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'dshfiles' } })
    expect(resource?.scopeSpans[0]?.scope.name).toBe('@dshfiles/dshx')
    const [span] = sink.spans()
    expect(span).toMatchObject({ name: 'outer', kind: 2, status: { code: 2, message: 'boom' } })
    expect(span).not.toHaveProperty('parentSpanId')
    expect(BigInt(span?.endTimeUnixNano ?? '0')).toBeGreaterThanOrEqual(BigInt(span?.startTimeUnixNano ?? '1'))
    expect(attribute(span!, 'count')).toEqual({ intValue: '3' })
    expect(attribute(span!, 'ratio')).toEqual({ doubleValue: 0.5 })
    expect(attribute(span!, 'ok')).toEqual({ boolValue: true })
    expect(attribute(span!, 'words')).toEqual({ arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } })
    expect(attribute(span!, 'skipped')).toBeUndefined()
  })

  it('encodes every kind and status code as its OTLP enum integer', () => {
    const kinds = (['internal', 'server', 'client', 'producer', 'consumer'] as const).map(
      kind => OtlpTraceExport.encode({ serviceName: 's', spans: [{ ...finishedSpan('k'), kind }] }).resourceSpans[0]?.scopeSpans[0]?.spans[0]?.kind,
    )
    expect(kinds).toEqual([1, 2, 3, 4, 5])
    const statuses = (['unset', 'ok', 'error'] as const).map(
      code =>
        OtlpTraceExport.encode({ serviceName: 's', spans: [{ ...finishedSpan('s'), status: { code, message: undefined } }] }).resourceSpans[0]?.scopeSpans[0]
          ?.spans[0]?.status.code,
    )
    expect(statuses).toEqual([0, 1, 2])
    const encoded = OtlpTraceExport.encode({ serviceName: 's', spans: [finishedSpan('t')] }).resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(encoded?.startTimeUnixNano).toBe('1700000000000000000')
    expect(encoded?.endTimeUnixNano).toBe('1700000000500000000')
  })

  it('bounds attribute strings, lists and count', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: ENDPOINT_ENV, fetch: sink.fetch })
    const span = tracer.startSpan('x'.repeat(500))
    span.setAttribute('long', 'y'.repeat(5_000))
    span.setAttribute(
      'list',
      Array.from({ length: 200 }, (_, index) => String(index)),
    )
    for (let index = 0; index < 100; index += 1) span.setAttribute(`key.${String(index)}`, index)
    span.end()
    await tracer.flush()
    const [exported] = sink.spans()
    expect(exported?.name).toHaveLength(128)
    expect(exported?.attributes).toHaveLength(64)
    expect(attribute(exported!, 'long')).toEqual({ stringValue: 'y'.repeat(1_024) })
    expect(z.object({ arrayValue: z.object({ values: z.array(z.unknown()) }) }).parse(attribute(exported!, 'list')).arrayValue.values).toHaveLength(64)
  })
})

describe('span parenting', () => {
  it('parents nested and concurrent spans through the async context', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: ENDPOINT_ENV, fetch: sink.fetch })
    await tracer.withSpan('root', {}, async () => {
      await Promise.all([
        tracer.withSpan('left', {}, async () => {
          await new Promise(resolve => setTimeout(resolve, 5))
          await tracer.withSpan('left.child', {}, async () => undefined)
        }),
        tracer.withSpan('right', {}, async () => undefined),
      ])
      tracer.startSpan('manual').end()
    })
    await tracer.withSpan('detached', { parent: null }, async () => undefined)
    await tracer.flush()

    const byName = new Map(sink.spans().map(span => [span.name, span]))
    const root = byName.get('root')
    expect(root?.parentSpanId).toBeUndefined()
    expect(byName.get('left')?.parentSpanId).toBe(root?.spanId)
    expect(byName.get('right')?.parentSpanId).toBe(root?.spanId)
    expect(byName.get('manual')?.parentSpanId).toBe(root?.spanId)
    expect(byName.get('left.child')?.parentSpanId).toBe(byName.get('left')?.spanId)
    expect(new Set([...byName.values()].filter(span => span.name !== 'detached').map(span => span.traceId)).size).toBe(1)
    expect(byName.get('detached')?.traceId).not.toBe(root?.traceId)
    expect(byName.get('detached')?.parentSpanId).toBeUndefined()
  })

  it('continues a remote trace from a W3C traceparent and emits one for the active span', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: ENDPOINT_ENV, fetch: sink.fetch })
    const remote = TracerModel.parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
    let header: string | undefined
    await tracer.runWithParent(remote, () =>
      tracer.withSpan('served', {}, async () => {
        header = tracer.traceparent()
      }),
    )
    await tracer.flush()
    const [span] = sink.spans()
    expect(span).toMatchObject({ traceId: '0af7651916cd43dd8448eb211c80319c', parentSpanId: 'b7ad6b7169203331' })
    expect(header).toBe(`00-${span?.traceId}-${span?.spanId}-01`)
    expect(TracerModel.parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeUndefined()
    expect(TracerModel.parseTraceparent('garbage')).toBeUndefined()
    expect(TracerModel.parseTraceparent(undefined)).toBeUndefined()
  })
})

describe('failures and redaction', () => {
  it('records only the error class and code, rethrowing the original error', async () => {
    const sink = collector()
    const tracer = TracerModel.create({ env: ENDPOINT_ENV, fetch: sink.fetch })
    const failure = Object.assign(new TypeError('token=sk-live-secret leaked in message'), { code: 'cli-failed' })
    await expect(
      tracer.withSpan('fails', {}, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    await tracer.flush()
    const [span] = sink.spans()
    expect(span?.status).toEqual({ code: 2, message: 'TypeError:cli-failed' })
    expect(attribute(span!, 'error.type')).toEqual({ stringValue: 'TypeError:cli-failed' })
    expect(sink.requests[0]?.body).not.toContain('sk-live-secret')
  })

  it('summarizes a command by subcommand and flag names, never values or positionals', () => {
    expect(
      commandAttributes({
        executable: '/opt/bin/jj',
        args: ['--ignore-working-copy', '--at-operation', 'abc123', 'workspace', 'list', '-T', 'name ++ root', '/Users/me/private'],
        valueFlags: ['--at-operation'],
      }),
    ).toEqual({
      'process.executable.name': 'jj',
      'process.command.verb': 'workspace list',
      'process.command.flags': ['--ignore-working-copy', '--at-operation', '-T'],
      'process.command.arg_count': 8,
    })
    const describe = commandAttributes({ executable: 'jj', args: ['describe', '-mSecret message', '--message=other', 'secretword'] })
    expect(describe['process.command.verb']).toBe('describe')
    expect(describe['process.command.flags']).toEqual(['-m', '--message'])
    expect(JSON.stringify(describe)).not.toMatch(/Secret|other|secretword/u)
  })

  it('wraps every API dispatch in one span carrying identity and outcome, never input or output', async () => {
    const sink = collector()
    const restore = installProcessTracer(TracerModel.create({ env: ENDPOINT_ENV, fetch: sink.fetch }))
    try {
      const vault = defineApi({
        id: 'vault',
        version: 1,
        methods: { reveal: method<{ alias: string }, { value: string }>(), explode: method<{ alias: string }, { value: string }>() },
      })
      const fixture = routeFixture()
      await registerApi(
        fixture.context as never,
        '@scope/vault',
        vault.host({
          reveal: async () => ({ value: 'OUTPUT-SECRET' }),
          explode: async () => {
            throw new Error('INTERNAL-SECRET')
          },
        }),
      )
      const parent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
      await fixture.post('@scope/vault', 'vault', 'reveal', { version: 1, input: { alias: 'INPUT-SECRET' } }, parent)
      await fixture.post('@scope/vault', 'vault', 'explode', { version: 1, input: { alias: 'INPUT-SECRET' } })
      await TracerModel.process().flush()

      const body = sink.requests.map(request => request.body).join('\n')
      expect(body).not.toMatch(/INPUT-SECRET|OUTPUT-SECRET|INTERNAL-SECRET/u)
      const spans = new Map(sink.spans().map(span => [span.name, span]))
      const reveal = spans.get('vault/reveal')
      expect(reveal).toMatchObject({ kind: 2, traceId: '4bf92f3577b34da6a3ce929d0e0e4736', parentSpanId: '00f067aa0ba902b7', status: { code: 0 } })
      expect(attribute(reveal!, 'dshx.plugin.package')).toEqual({ stringValue: '@scope/vault' })
      expect(attribute(reveal!, 'dshx.api.id')).toEqual({ stringValue: 'vault' })
      expect(attribute(reveal!, 'dshx.api.method')).toEqual({ stringValue: 'reveal' })
      expect(attribute(reveal!, 'dshx.api.caller')).toEqual({ stringValue: 'client' })
      expect(attribute(reveal!, 'dshx.api.outcome')).toEqual({ stringValue: 'ok' })
      expect(attribute(reveal!, 'dshx.api.duration_ms')).toMatchObject({ intValue: expect.stringMatching(/^\d+$/u) })
      const explode = spans.get('vault/explode')
      expect(explode).toMatchObject({ status: { code: 2, message: 'internal' } })
      expect(explode?.parentSpanId).toBeUndefined()
      expect(attribute(explode!, 'dshx.api.outcome')).toEqual({ stringValue: 'internal' })
    } finally {
      restore()
    }
  })
})

describe('batch exporter', () => {
  const config = { url: 'http://collector.test/v1/traces', headers: new Map<string, string>(), serviceName: 's' }

  it('drops new spans once the queue is full', async () => {
    const sink = collector()
    const exporter = OtlpTraceExport.createBatchExporter({ config, fetch: sink.fetch, maxQueueSize: 3, maxBatchSize: 10 })
    for (let index = 0; index < 5; index += 1) exporter.enqueue(finishedSpan(`s${String(index)}`))
    expect(exporter.stats()).toEqual({ queued: 3, dropped: 2, exported: 0 })
    await exporter.flush()
    expect(sink.spans().map(span => span.name)).toEqual(['s0', 's1', 's2'])
    expect(exporter.stats()).toEqual({ queued: 0, dropped: 2, exported: 3 })
  })

  it('retries a retryable status with backoff and drops a rejected batch', async () => {
    const sink = collector([503, 200, 400])
    const exporter = OtlpTraceExport.createBatchExporter({ config, fetch: sink.fetch, maxBatchSize: 1, initialBackoffMs: 1, maxBackoffMs: 2 })
    exporter.enqueue(finishedSpan('retried'))
    await waitFor(() => exporter.stats().exported === 1)
    expect(sink.requests).toHaveLength(2)
    exporter.enqueue(finishedSpan('rejected'))
    await waitFor(() => exporter.stats().dropped === 1)
    expect(sink.requests).toHaveLength(3)
    expect(exporter.stats().queued).toBe(0)
  })

  it('gives up after the attempt limit and never throws when the collector is unreachable', async () => {
    let calls = 0
    const exporter = OtlpTraceExport.createBatchExporter({
      config,
      fetch: async () => {
        calls += 1
        throw new Error('ECONNREFUSED')
      },
      maxBatchSize: 1,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxAttempts: 3,
    })
    exporter.enqueue(finishedSpan('lost'))
    await waitFor(() => exporter.stats().dropped === 1)
    expect(calls).toBe(3)
    exporter.enqueue(finishedSpan('flushed'))
    await expect(exporter.flush()).resolves.toBeUndefined()
    expect(exporter.stats()).toMatchObject({ queued: 0, dropped: 2 })
  })
})

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

const TRACER_KEY = Symbol.for('@dshfiles/dshx.tracing.v1')
let restoreTracer: (() => void) | undefined
afterEach(() => restoreTracer?.())

const installProcessTracer = (tracer: Tracer): (() => void) => {
  // SAFETY: the tracing module stores only a Tracer under this symbol.
  const holder = globalThis as { [TRACER_KEY]?: Tracer }
  const previous = holder[TRACER_KEY]
  holder[TRACER_KEY] = tracer
  restoreTracer = () => {
    if (previous === undefined) delete holder[TRACER_KEY]
    else holder[TRACER_KEY] = previous
    restoreTracer = undefined
  }
  return restoreTracer
}

const routeFixture = () => {
  const routes = new Map<string, ConnectionFetchRoute>()
  const context = {
    get: (name: string) =>
      name === 'connection'
        ? {
            operator: {},
            fetch: {
              register(route: ConnectionFetchRoute) {
                routes.set(route.path, route)
                return async () => {
                  routes.delete(route.path)
                }
              },
            },
          }
        : undefined,
    effect: () => undefined,
  }
  Object.assign(context, { root: context })
  const post = async (
    packageId: string,
    apiId: string,
    methodName: string,
    payload: { readonly version: number; readonly input: { readonly alias: string } },
    traceparent?: string,
  ): Promise<void> => {
    const endpoint = `${ApiProtocolModel.apiChannel(packageId, apiId).slice(1)}/${methodName}`
    const route = routes.get(`/api/${endpoint}`)
    if (route === undefined) throw new Error(`no route for ${endpoint}`)
    const headers = new Headers({ 'content-type': 'application/json' })
    if (traceparent !== undefined) headers.set('traceparent', traceparent)
    await route.fetch(
      new Request(`http://localhost/api/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'client-request', rpcId: 'rpc', method: endpoint, payload }),
      }),
    )
  }
  return { context, post }
}
