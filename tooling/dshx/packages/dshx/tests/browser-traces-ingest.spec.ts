import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApi, method } from '../src/api/index.js'
import { ApiProtocolModel } from '../src/api/common.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { defineHost } from '../src/host/index.js'
import { createTestHost, type TestHost } from '../src/testing/index.js'
import { BROWSER_TRACES_API, type BrowserSpanRecord } from '../src/tracing/browser-protocol.js'
import { BrowserTracesIngest } from '../src/tracing/browser-ingest.js'
import { BrowserTracerModel } from '../src/tracing/browser.js'
import { BrowserTracingRegistryModel } from '../src/tracing/browser-registry.js'
import { publishLocalOtlpEndpoint, recordSpans } from '../src/tracing/index.js'

const probe = defineApi({ id: 'probe', version: 1, owner: '@test/probe', methods: { ping: method<void, string>() } })
const probeHost = defineHost({ apis: [probe.host({ ping: () => 'pong' })] })

const OTEL_VARIABLES = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_SDK_DISABLED', 'OTEL_TRACES_EXPORTER'] as const

let cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
})

const withoutOtelEnvironment = (): void => {
  const saved = OTEL_VARIABLES.map(name => [name, process.env[name]] as const)
  for (const name of OTEL_VARIABLES) delete process.env[name]
  cleanups.push(() => {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value
  })
}

const rpcResultSchema = z.object({
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.object({ version: z.number(), output: z.unknown() }) }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
  ]),
})

const call = async (host: TestHost, methodName: 'status' | 'export', input?: unknown) => {
  const response = await host.connection.requestApi({
    packageId: BROWSER_TRACES_API.owner,
    apiId: BROWSER_TRACES_API.id,
    method: methodName,
    version: 1,
    input,
  })
  expect(response.status).toBe(200)
  return rpcResultSchema.parse(await response.json()).result
}

const hostWithLeader = async (): Promise<TestHost> => {
  const host = await createTestHost()
  cleanups.push(() => host.dispose())
  await host.mount(probeHost, { packageId: '@test/probe' })
  const deadline = Date.now() + 2_000
  while (
    (await host.connection.requestApi({ packageId: BROWSER_TRACES_API.owner, apiId: BROWSER_TRACES_API.id, method: 'status', version: 1, input: undefined }))
      .status === 404
  ) {
    if (Date.now() > deadline) throw new Error('the registry leader never served browser-traces')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return host
}

const receiver = async () => {
  const bodies: unknown[] = []
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void new Response(Buffer.concat(chunks)).json().then(body => {
        bodies.push(body)
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const withdraw = publishLocalOtlpEndpoint({ baseUrl: `http://127.0.0.1:${String(port)}`, owner: '@test/receiver' })
  cleanups.push(() => {
    withdraw()
    return new Promise<void>(resolve => server.close(() => resolve()))
  })
  return { bodies }
}

const keyValueSchema = z.object({ key: z.string(), value: z.record(z.string(), z.unknown()) })
const exportedSchema = z.object({
  resourceSpans: z.array(
    z.object({
      resource: z.object({ attributes: z.array(keyValueSchema) }),
      scopeSpans: z.array(
        z.object({
          spans: z.array(
            z.object({
              traceId: z.string(),
              spanId: z.string(),
              parentSpanId: z.string().optional(),
              name: z.string(),
              kind: z.number(),
              startTimeUnixNano: z.string(),
              attributes: z.array(keyValueSchema),
              events: z.array(z.object({ name: z.string(), timeUnixNano: z.string(), attributes: z.array(keyValueSchema) })).optional(),
            }),
          ),
        }),
      ),
    }),
  ),
})

const browserSpan = (overrides: Partial<BrowserSpanRecord> = {}): BrowserSpanRecord => {
  const start = Date.now() - 50
  return {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    name: 'thread switch',
    kind: 'internal',
    startTimeMs: start,
    endTimeMs: start + 40,
    attributes: { 'dshx.interaction': true },
    status: { code: 'unset' },
    events: [{ name: 'longtask', timeMs: start + 10, attributes: { 'browser.longtask.duration_ms': 230 } }],
    ...overrides,
  }
}

const RESOURCE = { engine: 'chromium', mobile: false } as const

const runtimeImports = (entry: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = readFileSync(entry, 'utf8')
  for (const match of source.matchAll(/^import (?!type )[^'"]*from '([^']+)'/gmu)) {
    const specifier = match[1] ?? ''
    if (specifier.startsWith('.')) runtimeImports(resolvePath(dirname(entry), specifier.replace(/\.js$/u, '.ts')), seen)
    else seen.add(specifier)
  }
  return seen
}

describe('browser tracing in Client bundles', () => {
  it('imports no Node module, schema library or Host tracer at runtime', () => {
    const source = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url))
    const imports = [...runtimeImports(source('tracing/client/index.ts')), ...runtimeImports(source('tracing/browser-transport.ts'))]
    expect(imports.filter(specifier => !specifier.startsWith('/'))).toEqual([])
    expect(imports.filter(path => /tracer\.ts$|otlp-exporter\.ts$|local-endpoint\.ts$|browser-ingest\.ts$/u.test(path))).toEqual([])
  })

  it('keeps the tracer out of plugins that only call APIs: they bundle the registry and transport', () => {
    const source = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url))
    const imports = [...runtimeImports(source('api/runtime.ts')), ...runtimeImports(source('tracing/browser-transport.ts'))]
    expect(imports.filter(path => path.endsWith('/tracing/browser.ts'))).toEqual([])
    expect(imports.some(path => path.endsWith('/tracing/browser-registry.ts'))).toBe(true)
  })
})

describe('browser traces ingest', () => {
  it('is served by the dshx registry leader and reports off without an export target', async () => {
    withoutOtelEnvironment()
    const host = await hostWithLeader()
    expect(await call(host, 'status')).toEqual({ ok: true, value: { version: 1, output: { enabled: false, sampleRatio: 1, maxRootSpansPerMinute: 60 } } })
    expect(await call(host, 'export', { resource: RESOURCE, spans: [browserSpan()] })).toEqual({
      ok: true,
      value: { version: 1, output: { accepted: 0, dropped: 1 } },
    })
    expect(host.connection.routeCount).toBe(1)
  })

  it('forwards to the in-process receiver as dshfiles-web with the engine resource, parent and events', async () => {
    withoutOtelEnvironment()
    const sink = await receiver()
    const host = await hostWithLeader()
    expect(await call(host, 'status')).toMatchObject({ ok: true, value: { output: { enabled: true } } })
    const child = browserSpan({ spanId: '1111111111111111', parentSpanId: '00f067aa0ba902b7', name: 'probe/ping', kind: 'client', events: [] })
    expect(await call(host, 'export', { resource: RESOURCE, spans: [browserSpan(), child] })).toMatchObject({
      ok: true,
      value: { output: { accepted: 2, dropped: 0 } },
    })
    await host.dispose()

    const exported = exportedSchema.parse(sink.bodies[0])
    const [resourceSpans] = exported.resourceSpans
    expect(Object.fromEntries(resourceSpans?.resource.attributes.map(attribute => [attribute.key, attribute.value]) ?? [])).toEqual({
      'service.name': { stringValue: 'dshfiles-web' },
      'telemetry.sdk.name': { stringValue: '@dshfiles/dshx' },
      'telemetry.sdk.language': { stringValue: 'webjs' },
      'browser.engine': { stringValue: 'chromium' },
      'browser.mobile': { boolValue: false },
    })
    const spans = resourceSpans?.scopeSpans[0]?.spans ?? []
    expect(spans.map(span => [span.name, span.kind, span.parentSpanId])).toEqual([
      ['thread switch', 1, undefined],
      ['probe/ping', 3, '00f067aa0ba902b7'],
    ])
    expect(spans[0]?.events?.[0]).toMatchObject({ name: 'longtask', attributes: [{ key: 'browser.longtask.duration_ms', value: { intValue: '230' } }] })
    expect(spans[0]?.startTimeUnixNano).toMatch(/^\d{19}$/u)
  })

  it('refuses unbounded input and drops implausible spans', async () => {
    withoutOtelEnvironment()
    await receiver()
    const host = await hostWithLeader()
    const tooMany = Array.from({ length: 129 }, () => browserSpan())
    expect(await call(host, 'export', { resource: RESOURCE, spans: tooMany })).toMatchObject({ ok: false, error: { code: 'contract' } })
    expect(await call(host, 'export', { resource: RESOURCE, spans: [browserSpan({ attributes: { 'Not A Key': 1 } })] })).toMatchObject({ ok: false })
    expect(await call(host, 'export', { resource: RESOURCE, spans: [browserSpan({ name: 'x'.repeat(129) })] })).toMatchObject({ ok: false })
    expect(await call(host, 'export', { resource: { engine: 'Mozilla/5.0', mobile: false }, spans: [] })).toMatchObject({ ok: false })
    const now = Date.now()
    const implausible = [
      browserSpan({ startTimeMs: now, endTimeMs: now - 1 }),
      browserSpan({ startTimeMs: now - 11 * 60_000, endTimeMs: now }),
      browserSpan({ startTimeMs: now + 2 * 3_600_000, endTimeMs: now + 2 * 3_600_000 + 1 }),
    ]
    expect(await call(host, 'export', { resource: RESOURCE, spans: implausible })).toMatchObject({ ok: true, value: { output: { accepted: 0, dropped: 3 } } })
  })

  it('caps forwarding per minute across every page', () => {
    let now = 1_000_000
    const forwarder = BrowserTracesIngest.createForwarder({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test:4318' },
      now: () => now,
      fetch: async () => new Response('{}'),
    })
    const batch = Array.from({ length: 128 }, () => browserSpan({ startTimeMs: now - 10, endTimeMs: now, events: [] }))
    const accepted = Array.from({ length: 10 }, () => forwarder.forward({ resource: RESOURCE, spans: batch }).accepted)
    expect(accepted.reduce((total, count) => total + count, 0)).toBe(1_200)
    now += 60_000
    expect(forwarder.forward({ resource: RESOURCE, spans: batch.map(span => ({ ...span, startTimeMs: now - 10, endTimeMs: now })) }).accepted).toBe(128)
  })

  it('never traces its own dispatch, so forwarding cannot feed back into itself', async () => {
    withoutOtelEnvironment()
    await receiver()
    const host = await hostWithLeader()
    using recorder = recordSpans()
    await call(host, 'status')
    await call(host, 'export', { resource: RESOURCE, spans: [browserSpan()] })
    await host.connection.requestApi({ packageId: '@test/probe', apiId: 'probe', method: 'ping', version: 1, input: undefined })
    expect(recorder.named(/^browser-traces\//u)).toEqual([])
    expect(recorder.named('probe/ping')).toHaveLength(1)
  })

  it('joins a browser API call and the Host dispatch span it causes in one trace', async () => {
    withoutOtelEnvironment()
    const host = await hostWithLeader()
    const registry = BrowserTracingRegistryModel.current()
    const previous = registry.tracer
    const browser = BrowserTracerModel.create({ scheduleDelayMs: 60_000 })
    registry.tracer = browser
    cleanups.push(() => {
      registry.tracer = previous
    })
    const rpc = {
      call: async (channel: string, endpoint: string, payload: unknown) => {
        expect(channel).toBe('/api')
        const response = await host.connection.requestRpc({ endpoint, payload })
        return rpcResultSchema.parse(await response.json()).result
      },
    }
    const client = ApiRuntimeModel.createClient({ get: (name: string) => (name === 'connection' ? { rpc } : undefined) }, probe)
    using hostSpans = recordSpans()
    using browserSpans = browser.record()

    const interaction = browser.startInteraction('thread switch')
    await client.ping()
    interaction.end()

    const root = browserSpans.span('thread switch')
    const clientSpan = browserSpans.span('probe/ping')
    const serverSpan = hostSpans.span('probe/ping')
    expect(clientSpan.parentSpanId).toBe(root.spanId)
    expect(serverSpan.traceId).toBe(root.traceId)
    expect(serverSpan.parentSpanId).toBe(clientSpan.spanId)
    expect(serverSpan.attributes).toMatchObject({ 'dshx.api.caller': 'client', 'dshx.api.outcome': 'ok' })
    expect(ApiProtocolModel.apiChannel(BROWSER_TRACES_API.owner, BROWSER_TRACES_API.id)).toMatch(/^\/dshx-/u)
  })
})
