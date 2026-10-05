import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { z } from 'zod'
import { GatewayUnavailableError } from './gateway.js'

const boundAddressSchema = z.object({ port: z.number().int().min(0).max(65_535) })

export type LoopbackEndpoint = {
  readonly address: string
  readonly port: number
  release(): void
}

const listen = async (server: Server, address: string, port = 0): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: address, port }, resolve)
  })
}

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
}

export const reserveLoopbackEndpoint = async (port = 0): Promise<LoopbackEndpoint> => {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new GatewayUnavailableError('invalid-runtime-locator', 'The runtime origin port is invalid.')
  }
  const address = '127.0.0.1'
  const probe = createServer()
  try {
    await listen(probe, address, port)
    const bound = boundAddressSchema.safeParse(probe.address())
    if (!bound.success) throw new Error('No TCP address was allocated.')
    await closeServer(probe)
    return { address, port: bound.data.port, release: () => {} }
  } catch {
    await closeServer(probe).catch(() => undefined)
    throw new GatewayUnavailableError('loopback-address-unavailable', 'The runtime loopback origin is unavailable on this machine.')
  }
}

export const createLoopbackForward = async ({
  target,
  originPort,
  signal,
}: {
  readonly target: URL
  readonly originPort?: number
  readonly signal?: AbortSignal
}): Promise<LoopbackEndpoint & { dispose(): Promise<void> }> => {
  const targetHost = target.hostname.replace(/^\[|\]$/g, '')
  const addressParts = targetHost.split('.')
  const targetIsLoopback =
    targetHost === 'localhost' ||
    targetHost === '::1' ||
    (addressParts.length === 4 && addressParts[0] === '127' && addressParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255))
  if (target.protocol !== 'http:' || !targetIsLoopback) {
    throw new GatewayUnavailableError('invalid-runtime-locator', 'The local runtime must use an HTTP loopback URL.')
  }
  if (signal?.aborted) throw new GatewayUnavailableError('cancelled', 'The local runtime request was cancelled.')
  const endpoint = await reserveLoopbackEndpoint(originPort)
  const server = createServer((client: Socket) => {
    if (signal?.aborted) {
      client.destroy()
      return
    }
    const upstream = createConnection({ host: targetHost, port: target.port === '' ? 80 : Number(target.port) })
    client.once('error', () => upstream.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
    upstream.once('close', () => client.destroy())
    upstream.once('connect', () => {
      if (client.destroyed) {
        upstream.destroy()
        return
      }
      client.pipe(upstream).pipe(client)
    })
  })
  const sockets = new Set<Socket>()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  try {
    await listen(server, endpoint.address, endpoint.port)
  } catch {
    endpoint.release()
    await closeServer(server).catch(() => undefined)
    throw new GatewayUnavailableError('loopback-forward-unavailable', 'The isolated local runtime listener could not be created.')
  }
  let disposed = false
  const onAbort = (): void => {
    void dispose()
  }
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', onAbort)
    for (const socket of sockets) socket.destroy()
    await closeServer(server)
    endpoint.release()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    await dispose()
    throw new GatewayUnavailableError('cancelled', 'The local runtime request was cancelled.')
  }
  return { ...endpoint, dispose }
}
