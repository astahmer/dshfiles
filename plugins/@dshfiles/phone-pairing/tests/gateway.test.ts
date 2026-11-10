import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPairingGateway, mintNativeCookie, type GatewayOptions } from '../src/gateway.ts'
import { createPairingStore } from '../src/store.ts'

const listen = async (server: http.Server): Promise<number> => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

const post = (port: number, path: string, body: unknown, cookie?: string) =>
  new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } },
      response => {
        response.resume()
        const header = response.headers['set-cookie']
        resolve({ status: response.statusCode ?? 0, cookie: header === undefined ? undefined : header[0]?.split(';')[0] })
      },
    )
    request.on('error', reject)
    request.end(JSON.stringify(body))
  })

const get = (port: number, path: string, cookie?: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: cookie ? { cookie } : {} }, response => {
      let body = ''
      response.on('data', chunk => (body += String(chunk)))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
    request.end()
  })

describe('pairing gateway', () => {
  it('refuses unpaired requests, pairs once, and proxies with the native cookie', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pairing-gateway-'))
    const upstream = http.createServer((request, response) => response.end(`native ${String(request.headers.cookie)}`))
    const upstreamPort = await listen(upstream)
    const reservation = http.createServer()
    const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const store = await createPairingStore({ path: join(directory, 'devices.json') })
    const offer = store.beginOffer()
    const gateway = createPairingGateway({
      upstream: upstreamPort,
      port,
      store,
      publicOrigin: 'https://phone.example',
      nativeCookie: async () => ({ value: 'dsh-auth=fixture', expiresAt: Number.POSITIVE_INFINITY }),
    })
    try {
      await gateway.listen()
      expect((await get(port, '/')).status).toBe(401)
      const refused = await post(port, '/pair/redeem', { code: '000000' })
      expect(refused.status).toBe(403)
      const paired = await post(port, '/pair/redeem', { id: offer.id, secret: offer.secret })
      expect(paired.status).toBe(303)
      expect(paired.cookie).toMatch(/^__Host-dsh_phone=/)
      const page = await get(port, '/', paired.cookie)
      expect(page.status).toBe(200)
      expect(page.body).toContain('native dsh-auth=fixture')
      const replay = await post(port, '/pair/redeem', { id: offer.id, secret: offer.secret })
      expect(replay.status).toBe(403)
      const deviceId = store.listDevices()[0]?.id ?? ''
      expect(await store.revoke(deviceId)).toBe(true)
      expect((await get(port, '/', paired.cookie)).status).toBe(401)
    } finally {
      gateway.closeAll()
      await new Promise(resolve => gateway.server.close(resolve))
      await new Promise(resolve => upstream.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('mints the native cookie once for concurrent requests and again after a 401', async () => {
    const upstream = http.createServer((request, response) => {
      response.statusCode = request.url === '/expire' && request.headers.cookie === 'dsh-auth=1' ? 401 : 200
      response.end(`native ${String(request.headers.cookie)}`)
    })
    let mints = 0
    const paired = await pairedGateway(await listen(upstream), async () => {
      mints += 1
      await new Promise(resolve => setTimeout(resolve, 20))
      return { value: `dsh-auth=${mints}`, expiresAt: Date.now() + 3_600_000 }
    })
    try {
      const first = await Promise.all(Array.from({ length: 10 }, () => get(paired.port, '/', paired.cookie)))
      expect(first.map(page => page.body)).toEqual(Array.from({ length: 10 }, () => 'native dsh-auth=1'))
      expect(mints).toBe(1)
      expect((await get(paired.port, '/expire', paired.cookie)).status).toBe(401)
      const second = await Promise.all(Array.from({ length: 5 }, () => get(paired.port, '/', paired.cookie)))
      expect(second.map(page => page.body)).toEqual(Array.from({ length: 5 }, () => 'native dsh-auth=2'))
      expect(mints).toBe(2)
    } finally {
      await paired.close()
      await new Promise(resolve => upstream.close(resolve))
    }
  })

  it('re-mints a native cookie that is about to expire', async () => {
    const upstream = http.createServer((request, response) => response.end(String(request.headers.cookie)))
    let mints = 0
    const paired = await pairedGateway(await listen(upstream), async () => {
      mints += 1
      return { value: `dsh-auth=${mints}`, expiresAt: Date.now() + 30_000 }
    })
    try {
      await get(paired.port, '/', paired.cookie)
      expect((await get(paired.port, '/', paired.cookie)).body).toBe('dsh-auth=2')
    } finally {
      await paired.close()
      await new Promise(resolve => upstream.close(resolve))
    }
  })

  it('reads the minted cookie and its lifetime without holding the redirect body open', async () => {
    let released: Promise<unknown> = Promise.resolve()
    const native = http.createServer((_request, response) => {
      released = once(response, 'close')
      response.writeHead(303, { location: './', 'set-cookie': 'dsh-auth=minted; Max-Age=600; Path=/; HttpOnly; SameSite=Strict' })
      response.write('x'.repeat(256 * 1024))
    })
    const port = await listen(native)
    try {
      const before = Date.now()
      const minted = await mintNativeCookie(`http://127.0.0.1:${port}/?token=fixture`)
      expect(minted?.value).toBe('dsh-auth=minted')
      expect(minted?.expiresAt).toBeGreaterThanOrEqual(before + 600_000)
      await released
    } finally {
      native.closeAllConnections()
      await new Promise(resolve => native.close(resolve))
    }
  })

  it.each([
    ['the client closes', 'client-destroy'],
    ['the client half-closes', 'client-end'],
    ['the upstream closes', 'upstream-destroy'],
    ['the upstream half-closes', 'upstream-end'],
  ] as const)('tears down the other WebSocket side when %s', async (_label, closer) => {
    const upstreamSockets: net.Socket[] = []
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket: net.Socket) => {
      upstreamSockets.push(socket)
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    })
    const paired = await pairedGateway(await listen(upstream), async () => ({ value: 'dsh-auth=fixture', expiresAt: Number.POSITIVE_INFINITY }))
    const client = net.connect(paired.port, '127.0.0.1')
    try {
      client.write(`GET /socket HTTP/1.1\r\nHost: phone.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${paired.cookie}\r\n\r\n`)
      const [greeting] = await once(client, 'data')
      expect(String(greeting)).toMatch(/^HTTP\/1\.1 101/)
      const [upstreamSocket] = upstreamSockets
      if (upstreamSocket === undefined) throw new Error('no upstream socket')
      const proxied = await paired.connections()
      const clientClosed = once(client, 'close')
      const upstreamEnded = once(upstreamSocket, 'end')
      client.on('error', () => undefined)
      upstreamSocket.on('error', () => undefined)
      if (closer === 'client-destroy') client.destroy()
      if (closer === 'client-end') client.end()
      if (closer === 'upstream-destroy') upstreamSocket.destroy()
      if (closer === 'upstream-end') upstreamSocket.end()
      if (closer.startsWith('client')) {
        upstreamSocket.resume()
        await upstreamEnded
        await vi.waitFor(async () => expect(await paired.connections()).toBe(proxied - 1))
      } else {
        client.resume()
        await clientClosed
      }
    } finally {
      client.destroy()
      for (const socket of upstreamSockets) socket.destroy()
      await paired.close()
      await new Promise(resolve => upstream.close(resolve))
    }
  })
})

const pairedGateway = async (upstream: number, nativeCookie: GatewayOptions['nativeCookie']) => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-gateway-'))
  const reservation = http.createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const store = await createPairingStore({ path: join(directory, 'devices.json') })
  const offer = store.beginOffer()
  const gateway = createPairingGateway({ upstream, port, store, publicOrigin: 'https://phone.example', nativeCookie })
  await gateway.listen()
  const { cookie } = await post(port, '/pair/redeem', { id: offer.id, secret: offer.secret })
  return {
    port,
    cookie,
    connections: () => new Promise<number>((resolve, reject) => gateway.server.getConnections((error, count) => (error ? reject(error) : resolve(count)))),
    close: async () => {
      gateway.closeAll()
      await new Promise(resolve => gateway.server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    },
  }
}
