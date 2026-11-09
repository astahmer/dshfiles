import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPairingGateway } from '../src/gateway.ts'
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
      nativeCookie: async () => 'dsh-auth=fixture',
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
})
