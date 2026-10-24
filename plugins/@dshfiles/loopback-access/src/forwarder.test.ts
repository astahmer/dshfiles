import { once } from 'node:events'
import { createServer, Socket } from 'node:net'
import type { Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { LoopbackForwarder } from './forwarder.js'

const servers: Server[] = []
const sockets = new Set<Socket>()
const forwarders: LoopbackForwarder[] = []
const unavailableIPv6Schema = z.object({ code: z.enum(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT']) })
const tcpAddressSchema = z.object({ address: z.string(), port: z.number().int().min(1).max(65_535) })

function track(socket: Socket): Socket {
  sockets.add(socket)
  socket.on('error', () => undefined)
  socket.once('close', () => sockets.delete(socket))
  return socket
}

function serverWith(handler: (socket: Socket) => void): Server {
  const server = createServer({ allowHalfOpen: true }, socket => handler(track(socket)))
  servers.push(server)
  return server
}

function portOf(server: Server): number {
  const parsed = tcpAddressSchema.safeParse(server.address())
  if (!parsed.success) throw new Error('Expected TCP listener')
  return parsed.data.port
}

async function listen(server: Server, host = '127.0.0.1', port = 0): Promise<number> {
  const ready = once(server, 'listening', { signal: AbortSignal.timeout(2_000) })
  server.listen({ host, port, ipv6Only: true })
  await ready
  return portOf(server)
}

async function ipv6Blocker(): Promise<Server | undefined> {
  const server = serverWith(() => undefined)
  try {
    await listen(server, '::1')
    return server
  } catch (error) {
    if (unavailableIPv6Schema.safeParse(error).success) return undefined
    throw error
  }
}

async function reserveLoopbackPair(): Promise<{ ipv4: Server; ipv6: Server; port: number } | undefined> {
  const addressInUse = z.object({ code: z.literal('EADDRINUSE') })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ipv4 = serverWith(() => undefined)
    const ipv6 = serverWith(() => undefined)
    let reserved = false
    try {
      const port = await listen(ipv4)
      await listen(ipv6, '::1', port)
      reserved = true
      return { ipv4, ipv6, port }
    } catch (error) {
      if (unavailableIPv6Schema.safeParse(error).success) return undefined
      if (!addressInUse.safeParse(error).success) throw error
    } finally {
      if (!reserved) await Promise.all([closeServer(ipv4), closeServer(ipv6)])
    }
  }
  throw new Error('Could not reserve an IPv4/IPv6 loopback port pair after 8 attempts')
}

async function bridge(port: number, listenPort = 0): Promise<LoopbackForwarder> {
  const forwarder = await LoopbackForwarder.start({ host: '127.0.0.1', port, listenPort })
  forwarders.push(forwarder)
  return forwarder
}

function ipv4Listener(forwarder: LoopbackForwarder): { host: string; port: number } {
  const listener = forwarder.listeners().find(({ host }) => host === '127.0.0.1')
  if (!listener) throw new Error('Expected IPv4 loopback listener')
  return listener
}

async function connect(listener: { host: string; port: number }): Promise<Socket> {
  const socket = track(new Socket())
  const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
  socket.connect(listener)
  await connected
  return socket
}

async function closed(socket: Socket): Promise<void> {
  await once(socket, 'close', { signal: AbortSignal.timeout(2_000) })
}

function readBytes(socket: Socket, length: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    const signal = AbortSignal.timeout(2_000)
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      socket.off('data', onData)
      socket.off('close', onClose)
      socket.off('error', onError)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Timed out waiting for bytes'))
    }
    const onClose = () => {
      cleanup()
      reject(new Error('Connection closed before expected bytes'))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      received += chunk.length
      if (received >= length) {
        cleanup()
        resolve(Buffer.concat(chunks))
      }
    }
    socket.on('data', onData)
    socket.once('close', onClose)
    socket.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

afterEach(async () => {
  await Promise.all(forwarders.splice(0).map(forwarder => forwarder.close()))
  for (const socket of sockets) socket.destroy()
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('LoopbackForwarder', () => {
  it('records bounded listen and connect spans without forwarded bytes or addresses', async () => {
    using recorder = recordSpans()
    const backend = serverWith(socket => socket.pipe(socket))
    const forwarder = await bridge(await listen(backend))
    const client = await connect(ipv4Listener(forwarder))
    const payload = Buffer.from('Cookie: private-test-cookie; token=private-test-token')
    const bytes = readBytes(client, payload.length)
    client.write(payload)
    expect(await bytes).toEqual(payload)
    await forwarder.close()
    expect(recorder.named('loopback listen')).toHaveLength(2)
    expect(recorder.span('loopback listen').attributes).toEqual({ 'network.type': 'ipv4' })
    expect(recorder.span('loopback connect')).toMatchObject({
      parentSpanId: undefined,
      kind: 'client',
      status: { code: 'ok' },
      attributes: { 'dshx.loopback-access.outcome': 'connected' },
    })
    for (const span of recorder.spans) {
      const metadata = JSON.stringify({ attributes: span.attributes, status: span.status })
      expect(metadata).not.toContain('private-test-')
      expect(metadata).not.toContain('127.0.0.1')
      expect(metadata).not.toContain('::1')
    }
  })

  it('records failed listener startup and refused upstream connections without error text', async () => {
    using recorder = recordSpans()
    const backend = serverWith(() => undefined)
    const port = await listen(backend)
    await expect(LoopbackForwarder.start({ host: '127.0.0.1', port })).rejects.toThrow('EADDRINUSE')
    expect(recorder.span('loopback listen').status.code).toBe('error')
    await closeServer(backend)
    const forwarder = await bridge(port)
    const client = await connect(ipv4Listener(forwarder))
    await closed(client)
    expect(recorder.span('loopback connect')).toMatchObject({
      status: { code: 'error' },
      attributes: { 'dshx.loopback-access.outcome': 'error' },
    })
    for (const span of recorder.spans) expect(span.status.message ?? '').not.toContain('127.0.0.1')
  })

  it('preserves exact HTTP Host, Origin and cookie request bytes and response bytes', async () => {
    let requestBytes: Promise<Buffer> | undefined
    const request = Buffer.from(
      'GET /events?cursor=example HTTP/1.1\r\n' +
        'Host: localhost:12345\r\n' +
        'Origin: http://localhost:12345\r\n' +
        'Cookie: session=opaque; preference=one%20two\r\n' +
        'Connection: keep-alive\r\n\r\n',
    )
    const response = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello')
    const backend = serverWith(socket => {
      requestBytes = readBytes(socket, request.length)
      socket.write(response)
    })
    const forwarder = await bridge(await listen(backend))
    const client = await connect(ipv4Listener(forwarder))
    const responseBytes = readBytes(client, response.length)
    client.write(request)
    expect(await responseBytes).toEqual(response)
    expect(requestBytes).toBeDefined()
    expect(await requestBytes).toEqual(request)
  })

  it('streams upgraded traffic and arbitrary bytes in both directions with backpressure', async () => {
    const backend = serverWith(socket => socket.pipe(socket))
    const forwarder = await bridge(await listen(backend))
    const client = await connect(ipv4Listener(forwarder))
    const upgrade = Buffer.from('GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    const upgraded = readBytes(client, upgrade.length)
    client.write(upgrade)
    expect(await upgraded).toEqual(upgrade)

    // Larger than socket high-water marks, including every byte value and NUL.
    const payload = Buffer.alloc(1_048_576)
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 256
    const echoed = readBytes(client, payload.length)
    client.write(payload)
    expect((await echoed).equals(payload)).toBe(true)

    // A second exchange proves the bridge remains a live stream, not a buffered request.
    const tail = Buffer.from([255, 0, 128, 1])
    const echoedTail = readBytes(client, tail.length)
    client.write(tail)
    expect(await echoedTail).toEqual(tail)
  })

  it('preserves half-close so a backend can reply after the client finishes writing', async () => {
    const response = Buffer.from('response after FIN')
    const backend = serverWith(socket => {
      socket.resume()
      socket.once('end', () => socket.end(response))
    })
    const forwarder = await bridge(await listen(backend))
    const client = await connect(ipv4Listener(forwarder))
    const bytes = readBytes(client, response.length)
    client.end('request')
    expect(await bytes).toEqual(response)
  })

  it('owns only actual IPv4 and available IPv6 loopback listeners', async () => {
    const supportsIPv6 = await ipv6Blocker()
    const backend = serverWith(socket => socket.pipe(socket))
    const forwarder = await bridge(await listen(backend))
    const listeners = forwarder.listeners()
    expect(listeners.map(({ host }) => host)).toEqual(supportsIPv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1'])
    for (const listener of listeners) {
      expect(listener.port).toBeGreaterThan(0)
      const client = await connect(listener)
      const bytes = readBytes(client, 4)
      client.write('ping')
      expect(await bytes).toEqual(Buffer.from('ping'))
    }
    listeners.splice(0)
    expect(forwarder.listeners().length).toBe(supportsIPv6 ? 2 : 1)
  })

  it('destroys idle and active duplex connections, releases both ports and closes idempotently', async () => {
    const backend = serverWith(socket => socket.pipe(socket))
    const forwarder = await bridge(await listen(backend))
    const listeners = forwarder.listeners()
    const clients = await Promise.all(listeners.map(connect))
    const active = clients[0]
    if (!active) throw new Error('Expected active connection')
    const data = readBytes(active, 6)
    active.write('active')
    expect(await data).toEqual(Buffer.from('active'))
    const connectionsClosed = clients.map(closed)
    const firstClose = forwarder.close()
    expect(forwarder.close()).toBe(firstClose)
    await firstClose
    await Promise.all(connectionsClosed)
    expect(forwarder.listeners()).toEqual([])
    for (const listener of listeners) {
      const replacement = serverWith(() => undefined)
      expect(await listen(replacement, listener.host, listener.port)).toBe(listener.port)
    }
    await forwarder.close()
  })

  it('rolls IPv4 back if the IPv6 port is occupied, without borrowing the blocker', async ({ skip }) => {
    // Allocate the backend first: its IPv4 ephemeral port must not become the rollback port.
    const backend = serverWith(() => undefined)
    const targetPort = await listen(backend)
    const reservation = await reserveLoopbackPair()
    if (!reservation) {
      skip()
      return
    }
    const { ipv4, ipv6: blocker, port } = reservation
    try {
      // IPv4 is proven free on this exact port; keep IPv6 occupied for the failure.
      await closeServer(ipv4)
      await expect(LoopbackForwarder.start({ host: '127.0.0.1', port: targetPort, listenPort: port })).rejects.toThrow(
        'Loopback forwarder could not bind loopback listeners (EADDRINUSE)',
      )
      expect(portOf(blocker)).toBe(port)
      const replacement = serverWith(() => undefined)
      expect(await listen(replacement, '127.0.0.1', port)).toBe(port)
      const client = await connect({ host: '::1', port })
      expect(client.remotePort).toBe(port)
    } finally {
      for (const socket of sockets) socket.destroy()
      await Promise.all([closeServer(ipv4), closeServer(blocker)])
    }
  })

  it('rejects an occupied IPv4 port rather than claiming somebody else’s listener', async () => {
    const backend = serverWith(socket => socket.pipe(socket))
    const port = await listen(backend)
    await expect(LoopbackForwarder.start({ host: '127.0.0.1', port })).rejects.toThrow('EADDRINUSE')
    const client = await connect({ host: '127.0.0.1', port })
    const bytes = readBytes(client, 5)
    client.write('owned')
    expect(await bytes).toEqual(Buffer.from('owned'))
  })

  it('closes clients cleanly when upstream connection fails', async () => {
    const backend = serverWith(() => undefined)
    const port = await listen(backend)
    await closeServer(backend)
    const forwarder = await bridge(port)
    const client = await connect(ipv4Listener(forwarder))
    await closed(client)
    expect(client.destroyed).toBe(true)
    await forwarder.close()
  })

  it('closes the upstream when a downstream disconnects', async () => {
    let upstream: Socket | undefined
    const backend = serverWith(socket => {
      upstream = socket
      socket.write('ready')
    })
    const forwarder = await bridge(await listen(backend))
    const client = await connect(ipv4Listener(forwarder))
    await readBytes(client, 5)
    if (!upstream) throw new Error('Expected upstream connection')
    // The test backend deliberately allows half-open connections: observe FIN,
    // then release its own writable half just like a normal TCP application.
    const ended = once(upstream, 'end', { signal: AbortSignal.timeout(2_000) })
    upstream.resume()
    client.destroy()
    await ended
    upstream.end()
  })

  it.each(['localhost', '0.0.0.0', '::', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0', '0:0:0:0:0:ffff:0:0', 'invalid.example'])(
    'rejects non-concrete target %s',
    async host => {
      await expect(LoopbackForwarder.start({ host, port: 3080, listenPort: 0 })).rejects.toThrow(
        'Loopback forwarder requires a concrete IP and valid TCP ports',
      )
    },
  )

  it.each([-1, 0, 65_536, 1.5, Number.NaN])('rejects invalid target port %s', async port => {
    await expect(LoopbackForwarder.start({ host: '127.0.0.1', port, listenPort: 0 })).rejects.toThrow(
      'Loopback forwarder requires a concrete IP and valid TCP ports',
    )
  })
})
