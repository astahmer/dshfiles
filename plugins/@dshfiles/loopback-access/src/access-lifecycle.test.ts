import { once } from 'node:events'
import { createServer, Socket } from 'node:net'
import type { Server } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { createTestHost } from '@dshfiles/dshx/testing'
import hostDefinition from './host.js'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { LoopbackAccess } from './access.js'

const lanHost = Object.values(networkInterfaces())
  .flat()
  .find(address => address?.family === 'IPv4' && !address.internal)?.address
const unavailableIPv6Schema = z.object({ code: z.enum(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT']) })
const tcpAddressSchema = z.object({ address: z.string(), port: z.number().int().min(1).max(65_535) })
const servers: Server[] = []
const sockets = new Set<Socket>()
const accesses: LoopbackAccess[] = []

function track(socket: Socket): Socket {
  sockets.add(socket)
  socket.on('error', () => undefined)
  socket.once('close', () => sockets.delete(socket))
  return socket
}

async function listen(host: string, port = 0): Promise<Server> {
  const server = createServer(socket => track(socket).pipe(socket))
  servers.push(server)
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(2_000) })
  server.listen({ host, port, ipv6Only: true, exclusive: true })
  await listening
  return server
}

function portOf(server: Server): number {
  const parsed = tcpAddressSchema.safeParse(server.address())
  if (!parsed.success) throw new Error('Expected a TCP listener')
  return parsed.data.port
}

function accessFor(host: string, backend: Server): LoopbackAccess {
  const port = portOf(backend)
  const access = new LoopbackAccess({ host, port, protocol: 'http:', getOrigin: () => `http://${host}:${String(port)}` })
  accesses.push(access)
  return access
}

async function expectPortsReleased(port: number): Promise<void> {
  await listen('127.0.0.1', port)
  try {
    await listen('::1', port)
  } catch (error) {
    if (!unavailableIPv6Schema.safeParse(error).success) throw error
  }
}

afterEach(async () => {
  await Promise.all(accesses.splice(0).map(access => access.close()))
  for (const socket of sockets) socket.destroy()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('LoopbackAccess real-socket lifetime', () => {
  it('mounts and disposes promised cleanup through upstream dshx and the native WebServer', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const host = await createTestHost()
    try {
      await host.ctx.plugin(WebServer, { host: lanHost, port: 0 })
      const port = host.ctx.webServer.port
      if (port === undefined) throw new Error('Native WebServer did not initialize its port')
      const plugin = await host.mount(hostDefinition, { packageId: '@dshfiles/loopback-access' })
      const client = track(new Socket())
      const connected = once(client, 'connect', { signal: AbortSignal.timeout(2_000) })
      client.connect({ host: '127.0.0.1', port })
      await connected
      const closed = once(client, 'close', { signal: AbortSignal.timeout(2_000) })
      await plugin.dispose()
      await closed
      await expectPortsReleased(port)
      expect(host.ctx.webServer.port).toBe(port)
    } finally {
      await host.dispose()
    }
  })

  it('closes while startup is pending and releases its same-port loopback listeners', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const backend = await listen(lanHost)
    const access = accessFor(lanHost, backend)
    const starting = access.start()
    const stopping = access.close()
    await Promise.all([starting, stopping, access.close()])
    expect(access.status()).toMatchObject({ state: 'stopped', localhostOrigin: null, listeners: [] })
    expect(backend.listening).toBe(true)
    await expectPortsReleased(portOf(backend))
  })

  it('can repeatedly start, stream and dispose without retaining listeners or active clients', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const backend = await listen(lanHost)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const access = accessFor(lanHost, backend)
      await access.start()
      const status = access.status()
      expect(status.state).toBe('forwarding')
      expect(status.localhostOrigin).toBe(`http://localhost:${String(portOf(backend))}`)
      expect(status.listeners).toContainEqual({ host: '127.0.0.1', port: portOf(backend) })
      const client = track(new Socket())
      const connected = once(client, 'connect', { signal: AbortSignal.timeout(2_000) })
      client.connect({ host: '127.0.0.1', port: portOf(backend) })
      await connected
      const bytes = once(client, 'data', { signal: AbortSignal.timeout(2_000) })
      client.write('lifecycle')
      expect((await bytes)[0]).toEqual(Buffer.from('lifecycle'))
      const closed = once(client, 'close', { signal: AbortSignal.timeout(2_000) })
      await access.close()
      await closed
      expect(access.status()).toMatchObject({ state: 'stopped', localhostOrigin: null, listeners: [] })
      expect(backend.listening).toBe(true)
    }
    await expectPortsReleased(portOf(backend))
  })

  it('lets official Cordis await and dispose a promised cleanup published after unload', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const backend = await listen(lanHost)
    const access = accessFor(lanHost, backend)
    const ctx = new Context()
    let publishCleanup: () => void = () => undefined
    const cleanupReady = new Promise<void>(resolve => {
      publishCleanup = resolve
    })
    let cleanups = 0
    const starting = access.start()
    const disposeEffect = ctx.effect(
      () =>
        starting.then(async () => {
          await cleanupReady
          return async () => {
            cleanups += 1
            await access.close()
          }
        }),
      'loopback-access test: delayed promised cleanup',
    )
    const disposing = disposeEffect()
    try {
      await starting
      expect(access.status().state).toBe('forwarding')
      expect(cleanups).toBe(0)
    } finally {
      publishCleanup()
      await disposing
    }
    await disposeEffect()
    expect(cleanups).toBe(1)
    expect(access.status()).toMatchObject({ state: 'stopped', localhostOrigin: null, listeners: [] })
    expect(backend.listening).toBe(true)
    await expectPortsReleased(portOf(backend))
  })

  it('keeps independent Context effects alive when a different Context disposes its adjunct', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const firstBackend = await listen(lanHost)
    const secondBackend = await listen(lanHost)
    const first = accessFor(lanHost, firstBackend)
    const second = accessFor(lanHost, secondBackend)
    const firstContext = new Context()
    const secondContext = new Context()
    const firstEffect = firstContext.effect(() => first.start().then(() => () => first.close()), 'first loopback adjunct')
    const secondEffect = secondContext.effect(() => second.start().then(() => () => second.close()), 'second loopback adjunct')
    await Promise.all([first.start(), second.start()])
    try {
      await firstEffect()
      expect(first.status()).toMatchObject({ state: 'stopped', listeners: [] })
      expect(second.status().state).toBe('forwarding')
      expect(second.status().listeners).toContainEqual({ host: '127.0.0.1', port: portOf(secondBackend) })
      await expectPortsReleased(portOf(firstBackend))
    } finally {
      await secondEffect()
    }
    expect(second.status()).toMatchObject({ state: 'stopped', listeners: [] })
    await expectPortsReleased(portOf(secondBackend))
  })
})
