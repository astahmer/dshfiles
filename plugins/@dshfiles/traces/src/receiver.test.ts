import { createServer, type IncomingMessage } from 'node:http'
import { gzipSync } from 'node:zlib'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { parseForwardUrl } from './forwarder.js'
import { SdkFixtures } from './otlp/sdk-fixture.test-support.js'
import { MAX_BODY_BYTES } from './receiver.js'
import { ReceiverHarness } from './receiver.test-support.js'
import { TraceRepo } from './trace-repo.js'

type Forwarded = { readonly path: string | undefined; readonly type: string | undefined; readonly bytes: number }

/** An upstream viewer that records each request it receives. */
const upstream = Effect.gen(function* () {
  const forwarded = yield* Ref.make<readonly Forwarded[]>([])
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      Effect.runSync(
        Ref.update(forwarded, seen => [...seen, { path: request.url, type: request.headers['content-type'], bytes: Buffer.concat(chunks).length }]),
      )
      response.end('{}')
    })
  })
  yield* Effect.acquireRelease(
    Effect.callback<void>(resume => {
      server.listen(0, '127.0.0.1', () => resume(Effect.void))
    }),
    () =>
      Effect.callback<void>(resume => {
        server.close(() => resume(Effect.void))
      }),
  )
  const address = server.address()
  return { port: typeof address === 'object' && address !== null ? address.port : 0, forwarded }
})

const storedSpans = TraceRepo.use(repo => Effect.map(repo.summary(), summary => summary.spans))

describe('OTLP/HTTP receiver', () => {
  it.live('stores protobuf, gzip protobuf and JSON trace bodies and answers in kind', () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(() => SdkFixtures.traces())
      yield* ReceiverHarness.untilState('listening')
      const url = yield* ReceiverHarness.boundUrl('/v1/traces')
      const protobuf = yield* ReceiverHarness.post(url, { headers: { 'content-type': 'application/x-protobuf' }, body: new Uint8Array(fixture.protobuf) })
      expect(protobuf.status).toBe(200)
      expect(protobuf.headers.get('content-type')).toBe('application/x-protobuf')
      const gzipped = yield* ReceiverHarness.post(url, {
        headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
        body: gzipSync(fixture.protobuf),
      })
      expect(gzipped.status).toBe(200)
      const json = yield* ReceiverHarness.post(url, { headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(fixture.json) })
      expect(json.status).toBe(200)
      expect(yield* Effect.promise(() => json.json())).toEqual({})
      expect(yield* ReceiverHarness.status).toMatchObject({ state: 'listening', requests: { traces: 3, metrics: 0, logs: 0 }, accepted: { traces: 6 } })
      expect(yield* storedSpans).toBe(2)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live('stores protobuf and JSON log bodies on /v1/logs', () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(() => SdkFixtures.logs())
      yield* ReceiverHarness.untilState('listening')
      const url = yield* ReceiverHarness.boundUrl('/v1/logs')
      const protobuf = yield* ReceiverHarness.post(url, { headers: { 'content-type': 'application/x-protobuf' }, body: new Uint8Array(fixture.protobuf) })
      const json = yield* ReceiverHarness.post(url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixture.json) })
      expect([protobuf.status, json.status]).toEqual([200, 200])
      expect(yield* ReceiverHarness.status).toMatchObject({ requests: { logs: 2 }, accepted: { logs: 6 } })
      expect((yield* TraceRepo.use(repo => repo.summary())).logs).toBe(6)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live('records an otlp ingest span for logs and metrics but none for traces, which would feed back into itself', () =>
    Effect.gen(function* () {
      const traces = yield* Effect.promise(() => SdkFixtures.traces())
      yield* ReceiverHarness.untilState('listening')
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        recording => Effect.sync(() => recording[Symbol.dispose]()),
      )
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/metrics'), {
        headers: { 'content-type': 'application/json' },
        body: '{"resourceMetrics":[]}',
      })
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(traces.json),
      })
      expect(recorder.named('otlp ingest').map(span => span.attributes['dshx.traces.signal'])).toEqual(['metrics'])
      expect(recorder.span('otlp ingest').attributes).toMatchObject({ 'dshx.traces.wire': 'json', 'dshx.traces.accepted': 0, 'dshx.traces.body_bytes': 22 })
      expect(recorder.spans.filter(span => span.name.startsWith('trace repo') || span.name.startsWith('otlp ingest store'))).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer().pipe(Layer.provide(DshxEffect.tracerLayer)))),
  )

  it.live('rejects wrong paths, methods, media types, oversize and malformed bodies', () =>
    Effect.gen(function* () {
      yield* ReceiverHarness.untilState('listening')
      expect(
        (yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/other'), { headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      ).toBe(404)
      const traces = yield* ReceiverHarness.boundUrl('/v1/traces')
      expect((yield* Effect.promise(() => fetch(traces))).status).toBe(405)
      expect((yield* ReceiverHarness.post(traces, { headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415)
      expect((yield* ReceiverHarness.post(traces, { headers: { 'content-type': 'application/json' }, body: '{oops' })).status).toBe(400)
      const oversize = yield* Effect.promise(() =>
        fetch(traces, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array(MAX_BODY_BYTES + 1) }).catch(() => null),
      )
      expect(oversize === null || oversize.status === 413).toBe(true)
      expect((yield* ReceiverHarness.status).rejectedRequests).toBeGreaterThanOrEqual(4)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live('reports a port held by another process and keeps the rest of the ReceiverHarness.status', () =>
    Effect.gen(function* () {
      const busy = yield* upstream
      yield* ReceiverHarness.updateSettings({ mode: 'plugin', port: busy.port })
      const inUse = yield* ReceiverHarness.untilState('port-in-use')
      expect(inUse).toMatchObject({ boundPort: null, configuredPort: busy.port })
      expect(inUse.message).toContain(String(busy.port))
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )

  it.live('refuses a non-loopback address unless it is opted into', () =>
    Effect.gen(function* () {
      expect((yield* ReceiverHarness.untilState('failed')).message).toMatch(/non-loopback/)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer({ host: '0.0.0.0' }))),
  )

  it.live('forwards the raw body to the external viewer and never to itself', () =>
    Effect.gen(function* () {
      const viewer = yield* upstream
      const fixture = yield* Effect.promise(() => SdkFixtures.traces())
      yield* ReceiverHarness.updateSettings({ forwardUrl: `http://127.0.0.1:${String(viewer.port)}/` })
      yield* ReceiverHarness.untilState('listening')
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), {
        headers: { 'content-type': 'application/x-protobuf' },
        body: new Uint8Array(fixture.protobuf),
      })
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/metrics'), {
        headers: { 'content-type': 'application/json' },
        body: '{"resourceMetrics":[]}',
      })
      yield* ReceiverHarness.eventually(ReceiverHarness.status, current => current.forward.forwarded === 2)
      expect(yield* Ref.get(viewer.forwarded)).toEqual([
        { path: '/v1/traces', type: 'application/x-protobuf', bytes: fixture.protobuf.length },
        { path: '/v1/metrics', type: 'application/json', bytes: 22 },
      ])
      expect((yield* ReceiverHarness.status).forward).toMatchObject({ forwarded: 2, failures: 0 })
      const port = (yield* ReceiverHarness.status).boundPort ?? 0
      yield* ReceiverHarness.updateSettings({ port, forwardUrl: `http://localhost:${String(port)}` })
      const self = yield* ReceiverHarness.eventually(ReceiverHarness.status, current => current.forward.url === null)
      expect(self.message).toBe('The forward URL points at this receiver; forwarding is off.')
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'both' }))),
  )

  it('parses forward URLs', () => {
    expect(parseForwardUrl('')).toEqual({ url: null, error: null })
    expect(parseForwardUrl('ftp://x')).toMatchObject({ url: null, error: expect.stringContaining('http') })
    expect(parseForwardUrl('http://127.0.0.1:4319/').url?.toString()).toBe('http://127.0.0.1:4319/')
  })
})

describe('state changes', () => {
  it.live('reports starting, listening with its bound port, then disabled, so the Host can publish and withdraw its address', () =>
    Effect.gen(function* () {
      yield* ReceiverHarness.untilListen(current => current.state === 'disabled')
      yield* ReceiverHarness.updateSettings({ mode: 'plugin' })
      expect(yield* ReceiverHarness.untilListen(current => current.state === 'listening')).toMatchObject({ boundPort: expect.any(Number) })
      yield* ReceiverHarness.updateSettings({ mode: 'external' })
      expect(yield* ReceiverHarness.untilState('disabled')).toMatchObject({ boundPort: null })
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )
})
