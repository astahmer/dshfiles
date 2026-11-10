import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref, Schema, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { MAX_BODY_BYTES, Receiver } from './receiver.js'
import { ReceiverHarness } from './receiver.test-support.js'

// The receiver lifecycle and HTTP edge, pinned before it became a FiberHandle-run scoped server (data-plugins
// review, traces). Complements receiver.test.ts.

/** Every listener state after the initial one, in order. */
const recordStates = Effect.gen(function* () {
  const states = yield* Ref.make<string[]>([])
  const receiver = yield* Receiver
  yield* Effect.forkScoped(Stream.runForEach(Stream.drop(receiver.changes, 1), next => Ref.update(states, seen => [...seen, next.state])))
  yield* Effect.yieldNow
  return Ref.get(states)
})

/** Raw HTTP so a declared Content-Length can exceed the limit without sending the body. */
const rawRequest = (port: number, head: string) =>
  Effect.callback<{ readonly status: number; readonly body: string }>(resume => {
    const socket = connect({ host: '127.0.0.1', port })
    let text = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      text += chunk
      const [headers, body] = text.split('\r\n\r\n')
      const length = Number(/content-length: (\d+)/i.exec(headers ?? '')?.[1] ?? 'NaN')
      if (body !== undefined && body.length >= length) {
        socket.destroy()
        resume(Effect.succeed({ status: Number(text.slice(9, 12)), body }))
      }
    })
    socket.write(head)
  })

const errorBody = Schema.fromJsonString(Schema.Struct({ code: Schema.Number, message: Schema.String }))

describe('receiver listen lifecycle', () => {
  it.effect('a port held by another process is retried every 30 s and taken once it frees', () =>
    Effect.gen(function* () {
      const held = yield* ReceiverHarness.occupyPort
      yield* ReceiverHarness.updateSettings({ mode: 'plugin', port: held.port })
      const inUse = yield* ReceiverHarness.untilState('port-in-use')
      expect(inUse).toMatchObject({ boundPort: null, configuredPort: held.port })
      expect(inUse.message).toContain('retries every 30 s')

      yield* held.release
      yield* TestClock.adjust(29_999)
      expect((yield* ReceiverHarness.status).state).toBe('port-in-use')
      yield* TestClock.adjust(1)
      expect(yield* ReceiverHarness.untilState('listening')).toMatchObject({ boundPort: held.port })
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )

  it.effect('a pending port retry is dropped when the configuration moves to another port', () =>
    Effect.gen(function* () {
      const held = yield* ReceiverHarness.occupyPort
      const other = yield* ReceiverHarness.freePort
      yield* ReceiverHarness.updateSettings({ mode: 'plugin', port: held.port })
      yield* ReceiverHarness.untilState('port-in-use')
      yield* ReceiverHarness.updateSettings({ port: other })
      yield* ReceiverHarness.untilListen(current => current.state === 'listening' && current.boundPort === other)
      yield* held.release
      yield* TestClock.adjust(30_000)
      expect((yield* ReceiverHarness.status).boundPort).toBe(other)
      expect(yield* ReceiverHarness.accepts(held.port)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )

  it.live('changing the port closes the old listener and binds the new one', () =>
    Effect.gen(function* () {
      const [first, second] = [yield* ReceiverHarness.freePort, yield* ReceiverHarness.freePort]
      const states = yield* recordStates
      yield* ReceiverHarness.updateSettings({ mode: 'plugin', port: first })
      yield* ReceiverHarness.untilListen(current => current.state === 'listening' && current.boundPort === first)
      yield* ReceiverHarness.updateSettings({ port: second })
      yield* ReceiverHarness.untilListen(current => current.state === 'listening' && current.boundPort === second)
      expect(yield* ReceiverHarness.accepts(first)).toBe(false)
      expect(yield* ReceiverHarness.accepts(second)).toBe(true)
      expect(yield* states).toEqual(['starting', 'listening', 'starting', 'listening'])
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )

  it.live('re-applying the same listen settings or only a new forward URL keeps the listener', () =>
    Effect.gen(function* () {
      const states = yield* recordStates
      yield* ReceiverHarness.updateSettings({ mode: 'both' })
      const listening = yield* ReceiverHarness.untilState('listening')
      yield* ReceiverHarness.updateSettings({ mode: 'both' })
      yield* ReceiverHarness.updateSettings({ forwardUrl: 'http://127.0.0.1:9' })
      expect(
        (yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), { headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      ).toBe(200)
      expect(yield* ReceiverHarness.status).toMatchObject({ state: 'listening', boundPort: listening.boundPort, startedAt: listening.startedAt })
      expect((yield* ReceiverHarness.status).forward.url).toBe('http://127.0.0.1:9/')
      expect(yield* states).toEqual(['starting', 'listening'])
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'external' }))),
  )

  it.live('a refused non-loopback address listens once it is opted into', () =>
    Effect.gen(function* () {
      yield* ReceiverHarness.updateSettings({ host: '0.0.0.0' })
      expect((yield* ReceiverHarness.untilState('failed')).message).toMatch(/non-loopback/)
      yield* ReceiverHarness.updateSettings({ allowNonLoopback: true })
      expect(yield* ReceiverHarness.untilState('listening')).toMatchObject({ address: '0.0.0.0' })
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live.each(['127.0.0.2', 'localhost', '::1'])('%s counts as loopback', host =>
    Effect.gen(function* () {
      const settled = yield* ReceiverHarness.untilListen(current => current.state !== 'disabled' && current.state !== 'starting')
      expect(settled.message ?? '').not.toMatch(/non-loopback/)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer({ host }))),
  )

  it.live('disabling closes the listener and reports disabled', () =>
    Effect.gen(function* () {
      const port = (yield* ReceiverHarness.untilState('listening')).boundPort ?? 0
      yield* ReceiverHarness.updateSettings({ mode: 'external' })
      expect(yield* ReceiverHarness.untilState('disabled')).toMatchObject({ boundPort: null, message: null, startedAt: null })
      expect(yield* ReceiverHarness.accepts(port)).toBe(false)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )
})

describe('receiver request rejections', () => {
  it.live('a declared body over 8 MiB is 413 before any byte is read', () =>
    Effect.gen(function* () {
      const port = (yield* ReceiverHarness.untilState('listening')).boundPort ?? 0
      const response = yield* rawRequest(
        port,
        `POST /v1/traces HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${String(MAX_BODY_BYTES + 1)}\r\n\r\n`,
      )
      expect(response.status).toBe(413)
      expect(Schema.decodeUnknownSync(errorBody)(response.body)).toEqual({ code: 413, message: 'Request body exceeds 8388608 bytes.' })
      expect(yield* ReceiverHarness.status).toMatchObject({ rejectedRequests: 1, requests: { traces: 0 } })
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live.each([
    { name: 'unknown path', path: '/v1/profiles', headers: { 'content-type': 'application/json' }, body: '{}', status: 404 },
    { name: 'unsupported media type', path: '/v1/traces', headers: { 'content-type': 'text/plain' }, body: 'x', status: 415 },
    {
      name: 'unsupported content-encoding',
      path: '/v1/traces',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      body: '{}',
      status: 415,
    },
    {
      name: 'corrupt gzip body',
      path: '/v1/traces',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: 'not gzip',
      status: 400,
    },
  ])('$name is $status with a JSON error body', ({ path, headers, body, status: expected }) =>
    Effect.gen(function* () {
      yield* ReceiverHarness.untilState('listening')
      const response = yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl(path), { headers, body })
      expect(response.status).toBe(expected)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(Schema.decodeUnknownSync(errorBody)(yield* Effect.promise(() => response.text()))).toMatchObject({ code: expected })
      expect((yield* ReceiverHarness.status).rejectedRequests).toBe(1)
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )

  it.live('a gzip JSON body is accepted and counted', () =>
    Effect.gen(function* () {
      yield* ReceiverHarness.untilState('listening')
      const response = yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), {
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: gzipSync('{}'),
      })
      expect(response.status).toBe(200)
      expect(yield* ReceiverHarness.status).toMatchObject({ requests: { traces: 1 }, accepted: { traces: 0 }, rejectedRequests: 0 })
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
  )
})

describe('receiver forwarding', () => {
  /** An upstream that holds every response until `release`. */
  const holdingUpstream = Effect.gen(function* () {
    const held: ServerResponse[] = []
    const received: string[] = []
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      received.push(request.url ?? '')
      request.resume()
      request.on('end', () => held.push(response))
    })
    yield* Effect.acquireRelease(
      Effect.callback<void>(resume => {
        server.listen(0, '127.0.0.1', () => resume(Effect.void))
      }),
      () =>
        Effect.callback<void>(resume => {
          for (const response of held.splice(0)) response.end('{}')
          server.close(() => resume(Effect.void))
        }),
    )
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    return {
      port,
      received,
      held,
      release: Effect.sync(() => {
        for (const response of held.splice(0)) response.end('{}')
      }),
    }
  })

  it.live('at most 8 forwards are in flight; extra batches are dropped and counted as failures', () =>
    Effect.gen(function* () {
      const upstream = yield* holdingUpstream
      yield* ReceiverHarness.updateSettings({ forwardUrl: `http://127.0.0.1:${String(upstream.port)}` })
      yield* ReceiverHarness.untilState('listening')
      const url = yield* ReceiverHarness.boundUrl('/v1/metrics')
      const responses = yield* Effect.all(
        Array.from({ length: 10 }, () => ReceiverHarness.post(url, { headers: { 'content-type': 'application/json' }, body: '{"resourceMetrics":[]}' })),
        { concurrency: 'unbounded' },
      )
      expect(responses.map(response => response.status)).toEqual(Array.from({ length: 10 }, () => 200))
      yield* ReceiverHarness.eventually(
        Effect.sync(() => upstream.held.length),
        length => length === 8,
      )
      expect((yield* ReceiverHarness.status).forward).toMatchObject({ forwarded: 0, failures: 2, lastError: 'Dropped: too many forwards in flight.' })
      yield* upstream.release
      yield* ReceiverHarness.eventually(ReceiverHarness.status, current => current.forward.forwarded === 8)
      expect((yield* ReceiverHarness.status).forward.failures).toBe(2)
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'both' }))),
  )

  it.live('a non-2xx upstream answer is a forward failure naming the status and origin', () =>
    Effect.gen(function* () {
      const server = createServer((request, response) => {
        request.resume()
        request.on('end', () => {
          response.writeHead(503)
          response.end()
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
      const port = typeof address === 'object' && address !== null ? address.port : 0
      yield* ReceiverHarness.updateSettings({ forwardUrl: `http://127.0.0.1:${String(port)}/` })
      yield* ReceiverHarness.untilState('listening')
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), { headers: { 'content-type': 'application/json' }, body: '{}' })
      const failed = yield* ReceiverHarness.eventually(ReceiverHarness.status, current => current.forward.failures === 1)
      expect(failed.forward).toMatchObject({ forwarded: 0, lastError: `HTTP 503 from http://127.0.0.1:${String(port)}` })
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'both' }))),
  )

  it.live('a rejected request is never forwarded', () =>
    Effect.gen(function* () {
      const upstream = yield* holdingUpstream
      yield* ReceiverHarness.updateSettings({ forwardUrl: `http://127.0.0.1:${String(upstream.port)}` })
      yield* ReceiverHarness.untilState('listening')
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/traces'), { headers: { 'content-type': 'text/plain' }, body: 'x' })
      yield* ReceiverHarness.post(yield* ReceiverHarness.boundUrl('/v1/metrics'), {
        headers: { 'content-type': 'application/json' },
        body: '{"resourceMetrics":[]}',
      })
      yield* ReceiverHarness.eventually(
        Effect.sync(() => upstream.received.length),
        length => length > 0,
      )
      expect(upstream.received).toEqual(['/v1/metrics'])
    }).pipe(Effect.scoped, Effect.provide(ReceiverHarness.receiverLayer({ mode: 'both' }))),
  )

  it.live('a forward URL that is not http(s) is reported in the status message and forwards nothing', () =>
    Effect.gen(function* () {
      yield* ReceiverHarness.untilState('listening')
      expect(yield* ReceiverHarness.status).toMatchObject({ message: 'The forward URL must be an http(s) URL.', forward: { url: null } })
    }).pipe(Effect.provide(ReceiverHarness.receiverLayer({ mode: 'both', forwardUrl: 'ftp://collector' }))),
  )

  it.live('unloading closes the listener', () =>
    Effect.gen(function* () {
      const port = yield* Effect.scoped(
        Effect.map(ReceiverHarness.untilState('listening'), listening => listening.boundPort ?? 0).pipe(Effect.provide(ReceiverHarness.receiverLayer())),
      )
      expect(yield* ReceiverHarness.accepts(port)).toBe(false)
    }),
  )
})
