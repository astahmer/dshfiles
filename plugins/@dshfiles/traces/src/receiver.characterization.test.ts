import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, createServer as createNetServer, type Server as NetServer } from 'node:net'
import { gzipSync } from 'node:zlib'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MAX_BODY_BYTES, OtlpReceiver, type Receiver, type ReceiverConfig } from './receiver.js'

// The receiver lifecycle and HTTP edge, pinned before it becomes a FiberHandle-run scoped server (data-plugins
// review, traces). Complements receiver.test.ts.

const receivers: Receiver[] = []
const servers: Array<Server | NetServer> = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(receivers.splice(0).map(receiver => receiver.stop()))
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

const baseConfig: ReceiverConfig = { enabled: true, host: '127.0.0.1', allowNonLoopback: false, port: 0, forwardUrl: '' }

const portOf = (server: Pick<NetServer, 'address'>): number => Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port

const occupyPort = async (): Promise<{ readonly port: number; readonly release: () => Promise<void> }> => {
  const server = createNetServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: portOf(server), release: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

const freePort = async (): Promise<number> => {
  const held = await occupyPort()
  await held.release()
  return held.port
}

const makeReceiver = () => {
  const changes: string[] = []
  const receiver: Receiver = OtlpReceiver.create({
    handlers: { traces: () => ({ accepted: 1, rejected: 0 }), metrics: () => ({ accepted: 1, rejected: 0 }) },
    onStateChange: () => changes.push(receiver.status().state),
  })
  receivers.push(receiver)
  return { receiver, changes }
}

const accepts = (port: number): Promise<boolean> =>
  new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

/** Raw HTTP so a declared Content-Length can exceed the limit without sending the body. */
const rawRequest = (port: number, head: string): Promise<{ readonly status: number; readonly body: string }> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let text = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      text += chunk
      const [headers, body] = text.split('\r\n\r\n')
      const length = Number(/content-length: (\d+)/i.exec(headers ?? '')?.[1] ?? 'NaN')
      if (body !== undefined && body.length >= length) {
        socket.destroy()
        resolve({ status: Number(text.slice(9, 12)), body })
      }
    })
    socket.once('error', reject)
    socket.write(head)
  })

const errorBody = Schema.Struct({ code: Schema.Number, message: Schema.String })

describe('receiver listen lifecycle', () => {
  test('a port held by another process is retried every 30 s and taken once it frees', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const held = await occupyPort()
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, port: held.port })
    expect(receiver.status()).toMatchObject({ state: 'port-in-use', boundPort: null })
    expect(receiver.status().message).toContain('retries every 30 s')

    await held.release()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(receiver.status().state).toBe('port-in-use')
    await vi.advanceTimersByTimeAsync(1)
    await expect.poll(() => receiver.status().state).toBe('listening')
    expect(receiver.status().boundPort).toBe(held.port)
  })

  test('a pending port retry is dropped when the configuration moves to another port', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const held = await occupyPort()
    const other = await freePort()
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, port: held.port })
    expect(receiver.status().state).toBe('port-in-use')
    await receiver.apply({ ...baseConfig, port: other })
    await expect.poll(() => receiver.status().state).toBe('listening')
    await held.release()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(receiver.status().boundPort).toBe(other)
    expect(await accepts(held.port)).toBe(false)
  })

  test('changing the port closes the old listener and binds the new one', async () => {
    const [first, second] = [await freePort(), await freePort()]
    const { receiver, changes } = makeReceiver()
    await receiver.apply({ ...baseConfig, port: first })
    await expect.poll(() => receiver.status().state).toBe('listening')
    await receiver.apply({ ...baseConfig, port: second })
    await expect.poll(() => receiver.status().boundPort).toBe(second)
    expect(await accepts(first)).toBe(false)
    expect(await accepts(second)).toBe(true)
    expect(changes).toEqual(['starting', 'listening', 'starting', 'listening'])
  })

  test('re-applying the same listen settings or only a new forward URL keeps the listener', async () => {
    const { receiver, changes } = makeReceiver()
    await receiver.apply(baseConfig)
    await expect.poll(() => receiver.status().state).toBe('listening')
    const { boundPort, startedAt } = receiver.status()
    await receiver.apply(baseConfig)
    await receiver.apply({ ...baseConfig, forwardUrl: 'http://127.0.0.1:9' })
    expect(receiver.status()).toMatchObject({ state: 'listening', boundPort, startedAt })
    expect(receiver.status().forward.url).toBe('http://127.0.0.1:9/')
    expect(changes).toEqual(['starting', 'listening'])
  })

  test('a failed state is retried by re-applying the same settings', async () => {
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, host: '0.0.0.0' })
    expect(receiver.status().state).toBe('failed')
    await receiver.apply({ ...baseConfig, host: '0.0.0.0', allowNonLoopback: true })
    await expect.poll(() => receiver.status().state).toBe('listening')
    expect(receiver.status().address).toBe('0.0.0.0')
  })

  test.each(['127.0.0.2', 'localhost', '::1'])('%s counts as loopback', async host => {
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, host })
    expect(receiver.status().message ?? '').not.toMatch(/non-loopback/)
  })

  test('disabling closes the listener and reports disabled', async () => {
    const { receiver, changes } = makeReceiver()
    await receiver.apply(baseConfig)
    await expect.poll(() => receiver.status().state).toBe('listening')
    const port = receiver.status().boundPort ?? 0
    await receiver.apply({ ...baseConfig, enabled: false })
    expect(receiver.status()).toMatchObject({ state: 'disabled', boundPort: null, message: null })
    expect(await accepts(port)).toBe(false)
    expect(changes.at(-1)).toBe('disabled')
  })
})

describe('receiver request rejections', () => {
  const started = async () => {
    const { receiver } = makeReceiver()
    await receiver.apply(baseConfig)
    await expect.poll(() => receiver.status().state).toBe('listening')
    const port = receiver.status().boundPort ?? 0
    return { receiver, port, url: (path: string) => `http://127.0.0.1:${String(port)}${path}` }
  }

  test('a declared body over 8 MiB is 413 before any byte is read', async () => {
    const { receiver, port } = await started()
    const response = await rawRequest(
      port,
      `POST /v1/traces HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${String(MAX_BODY_BYTES + 1)}\r\n\r\n`,
    )
    expect(response.status).toBe(413)
    expect(Schema.decodeUnknownSync(errorBody)(JSON.parse(response.body))).toEqual({ code: 413, message: 'Request body exceeds 8388608 bytes.' })
    expect(receiver.status()).toMatchObject({ rejectedRequests: 1, requests: { traces: 0 } })
  })

  test.each([
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
  ])('$name is $status with a JSON error body', async ({ path, headers, body, status }) => {
    const { receiver, url } = await started()
    const response = await fetch(url(path), { method: 'POST', headers, body })
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(Schema.decodeUnknownSync(errorBody)(await response.json())).toMatchObject({ code: status })
    expect(receiver.status().rejectedRequests).toBe(1)
  })

  test('a path whose signal has no handler is 404', async () => {
    const logsOnly = OtlpReceiver.create({ handlers: { traces: () => ({ accepted: 0, rejected: 0 }) } })
    receivers.push(logsOnly)
    await logsOnly.apply(baseConfig)
    await expect.poll(() => logsOnly.status().state).toBe('listening')
    const response = await fetch(`http://127.0.0.1:${String(logsOnly.status().boundPort)}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(404)
  })

  test('a gzip JSON body is accepted and counted', async () => {
    const { receiver, url } = await started()
    const response = await fetch(url('/v1/traces'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: gzipSync('{}'),
    })
    expect(response.status).toBe(200)
    expect(receiver.status()).toMatchObject({ requests: { traces: 1 }, accepted: { traces: 1 }, rejectedRequests: 0 })
  })
})

describe('receiver forwarding', () => {
  const holdingUpstream = async () => {
    const held: ServerResponse[] = []
    const received: string[] = []
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      received.push(request.url ?? '')
      request.resume()
      request.on('end', () => held.push(response))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return {
      port: portOf(server),
      received,
      held,
      release: () => {
        for (const response of held.splice(0)) response.end('{}')
      },
    }
  }

  test('at most 8 forwards are in flight; extra batches are dropped and counted as failures', async () => {
    const upstream = await holdingUpstream()
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, forwardUrl: `http://127.0.0.1:${String(upstream.port)}` })
    await expect.poll(() => receiver.status().state).toBe('listening')
    const url = `http://127.0.0.1:${String(receiver.status().boundPort)}/v1/metrics`
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"resourceMetrics":[]}' })),
    )
    expect(responses.map(response => response.status)).toEqual(Array.from({ length: 10 }, () => 200))
    await expect.poll(() => upstream.held.length).toBe(8)
    expect(receiver.status().forward).toMatchObject({ forwarded: 0, failures: 2, lastError: 'Dropped: too many forwards in flight.' })
    upstream.release()
    await expect.poll(() => receiver.status().forward.forwarded).toBe(8)
    expect(receiver.status().forward.failures).toBe(2)
  })

  test('a non-2xx upstream answer is a forward failure naming the status and origin', async () => {
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(503)
        response.end()
      })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = portOf(server)
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, forwardUrl: `http://127.0.0.1:${String(port)}/` })
    await expect.poll(() => receiver.status().state).toBe('listening')
    await fetch(`http://127.0.0.1:${String(receiver.status().boundPort)}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    await expect.poll(() => receiver.status().forward.failures).toBe(1)
    expect(receiver.status().forward).toMatchObject({ forwarded: 0, lastError: `HTTP 503 from http://127.0.0.1:${String(port)}` })
  })

  test('a rejected request is never forwarded', async () => {
    const upstream = await holdingUpstream()
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, forwardUrl: `http://127.0.0.1:${String(upstream.port)}` })
    await expect.poll(() => receiver.status().state).toBe('listening')
    await fetch(`http://127.0.0.1:${String(receiver.status().boundPort)}/v1/traces`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(upstream.received).toEqual([])
  })

  test('a forward URL that is not http(s) is reported in the status message and forwards nothing', async () => {
    const { receiver } = makeReceiver()
    await receiver.apply({ ...baseConfig, forwardUrl: 'ftp://collector' })
    await expect.poll(() => receiver.status().state).toBe('listening')
    expect(receiver.status()).toMatchObject({ message: 'The forward URL must be an http(s) URL.', forward: { url: null } })
  })
})
