import { createServer, type IncomingMessage, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, test } from 'vitest'
import { OtlpBody } from './otlp/decode.js'
import { SpanNormalizer, type NormalizedLog, type NormalizedSpan } from './otlp/normalize.js'
import { SdkFixtures } from './otlp/sdk-fixture.test-support.js'
import { MAX_BODY_BYTES, OtlpReceiver, type Receiver, type ReceiverConfig } from './receiver.js'

const REDACT = { redactContent: true }
const receivers: Receiver[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(receivers.splice(0).map(receiver => receiver.stop()))
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

const baseConfig: ReceiverConfig = { enabled: true, host: '127.0.0.1', allowNonLoopback: false, port: 0, forwardUrl: '' }

const startReceiver = async (config: Partial<ReceiverConfig> = {}) => {
  const stored: NormalizedSpan[] = []
  const storedLogs: NormalizedLog[] = []
  const receiver = OtlpReceiver.create({
    handlers: {
      traces: input => {
        const normalized = SpanNormalizer.normalizeTraces(OtlpBody.decodeTraces(input), REDACT)
        stored.push(...normalized.spans)
        return { accepted: normalized.spans.length, rejected: normalized.rejected }
      },
      logs: input => {
        const normalized = SpanNormalizer.normalizeLogs(OtlpBody.decodeLogs(input), REDACT)
        storedLogs.push(...normalized.logs)
        return { accepted: normalized.logs.length, rejected: normalized.rejected }
      },
      metrics: input => {
        const normalized = SpanNormalizer.normalizeMetrics(OtlpBody.decodeMetrics(input), REDACT)
        return { accepted: normalized.points.length, rejected: normalized.rejected }
      },
    },
  })
  receivers.push(receiver)
  await receiver.apply({ ...baseConfig, ...config })
  await expect.poll(() => receiver.status().state).not.toBe('starting')
  return { receiver, stored, storedLogs, url: (path: string) => `http://127.0.0.1:${String(receiver.status().boundPort)}${path}` }
}

const listen = async (handler: (request: IncomingMessage, body: Buffer) => void): Promise<number> => {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      handler(request, Buffer.concat(chunks))
      response.end('{}')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('The test server has no TCP address.')
  return address.port
}

describe('OTLP/HTTP receiver', () => {
  test('stores protobuf, gzip protobuf and JSON trace bodies and answers in kind', async () => {
    const fixture = await SdkFixtures.traces()
    const { receiver, stored, url } = await startReceiver()
    const protobuf = await fetch(url('/v1/traces'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: new Uint8Array(fixture.protobuf),
    })
    expect(protobuf.status).toBe(200)
    expect(protobuf.headers.get('content-type')).toBe('application/x-protobuf')
    const gzipped = await fetch(url('/v1/traces'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
      body: gzipSync(fixture.protobuf),
    })
    expect(gzipped.status).toBe(200)
    const json = await fetch(url('/v1/traces'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(fixture.json),
    })
    expect(json.status).toBe(200)
    expect(await json.json()).toEqual({})
    expect(stored).toHaveLength(6)
    expect(receiver.status()).toMatchObject({ state: 'listening', requests: { traces: 3, metrics: 0, logs: 0 }, accepted: { traces: 6 } })
  })

  test('stores protobuf and JSON log bodies on /v1/logs', async () => {
    const fixture = await SdkFixtures.logs()
    const { receiver, storedLogs, url } = await startReceiver()
    const protobuf = await fetch(url('/v1/logs'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: new Uint8Array(fixture.protobuf),
    })
    const json = await fetch(url('/v1/logs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixture.json) })
    expect([protobuf.status, json.status]).toEqual([200, 200])
    expect(storedLogs).toHaveLength(6)
    expect(receiver.status()).toMatchObject({ requests: { logs: 2 }, accepted: { logs: 6 } })
  })

  test('rejects wrong paths, methods, media types, oversize and malformed bodies', async () => {
    const { receiver, url } = await startReceiver()
    expect((await fetch(url('/v1/other'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await fetch(url('/v1/traces'))).status).toBe(405)
    expect((await fetch(url('/v1/traces'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415)
    expect((await fetch(url('/v1/traces'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status).toBe(400)
    const oversize = await fetch(url('/v1/traces'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array(MAX_BODY_BYTES + 1),
    }).catch(() => null)
    expect(oversize === null || oversize.status === 413).toBe(true)
    expect(receiver.status().rejectedRequests).toBeGreaterThanOrEqual(4)
  })

  test('reports a port held by another process and keeps the rest of the status', async () => {
    const busyPort = await listen(() => undefined)
    const { receiver } = await startReceiver({ port: busyPort })
    expect(receiver.status()).toMatchObject({ state: 'port-in-use', boundPort: null, configuredPort: busyPort })
    expect(receiver.status().message).toContain(String(busyPort))
  })

  test('refuses a non-loopback address unless it is opted into', async () => {
    const { receiver } = await startReceiver({ host: '0.0.0.0' })
    expect(receiver.status()).toMatchObject({ state: 'failed' })
    expect(receiver.status().message).toMatch(/non-loopback/)
  })

  test('forwards the raw body to the external viewer and never to itself', async () => {
    const forwarded: { readonly path: string | undefined; readonly type: string | undefined; readonly bytes: number }[] = []
    const upstreamPort = await listen((request, body) => forwarded.push({ path: request.url, type: request.headers['content-type'], bytes: body.length }))
    const fixture = await SdkFixtures.traces()
    const { receiver, url } = await startReceiver({ forwardUrl: `http://127.0.0.1:${String(upstreamPort)}/` })
    await fetch(url('/v1/traces'), { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: new Uint8Array(fixture.protobuf) })
    await fetch(url('/v1/metrics'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"resourceMetrics":[]}' })
    await expect.poll(() => forwarded.length).toBe(2)
    expect(forwarded).toEqual([
      { path: '/v1/traces', type: 'application/x-protobuf', bytes: fixture.protobuf.length },
      { path: '/v1/metrics', type: 'application/json', bytes: 22 },
    ])
    expect(receiver.status().forward).toMatchObject({ forwarded: 2, failures: 0 })
    const port = receiver.status().boundPort ?? 0
    await receiver.apply({ ...baseConfig, port, forwardUrl: `http://localhost:${String(port)}` })
    expect(receiver.status().forward.url).toBeNull()
  })

  test('parses forward URLs', () => {
    expect(OtlpReceiver.parseForwardUrl('')).toEqual({ url: null, error: null })
    expect(OtlpReceiver.parseForwardUrl('ftp://x')).toMatchObject({ url: null, error: expect.stringContaining('http') })
    expect(OtlpReceiver.parseForwardUrl('http://127.0.0.1:4319/').url?.toString()).toBe('http://127.0.0.1:4319/')
  })
})

describe('state changes', () => {
  test('reports listening with its bound port, then disabled, so the Host can publish and withdraw its address', async () => {
    const seen: string[] = []
    const receiver: Receiver = OtlpReceiver.create({
      handlers: {},
      onStateChange: () => seen.push(`${receiver.status().state}:${String(receiver.status().boundPort !== null)}`),
    })
    receivers.push(receiver)
    await receiver.apply(baseConfig)
    await expect.poll(() => seen.at(-1)).toBe('listening:true')
    await receiver.apply({ ...baseConfig, enabled: false })
    expect(seen.at(-1)).toBe('disabled:false')
    expect(seen[0]).toBe('starting:false')
  })
})
