import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createPairHandler, createPairing } from '../src/pairing.js'

const token = 'b'.repeat(43)
const origin = `chrome-extension://${'a'.repeat(32)}`

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve())
        }),
    ),
  )
})

const start = async ({ allowedOrigins = [origin], windowMs = 60_000 }: { allowedOrigins?: readonly string[]; windowMs?: number } = {}) => {
  const pairing = createPairing({ token: () => token, windowMs })
  const handler = createPairHandler({ pairing, allowedOrigins: () => allowedOrigins })
  const server = createServer((request, response) => handler(request, response))
  servers.push(server)
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return { base: `http://127.0.0.1:${address.port}`, pairing }
}

const post = ({ base, requestOrigin = origin }: { base: string; requestOrigin?: string }): Promise<Response> =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin }, body: '{}' })

describe('pairing', () => {
  it('refuses before the window is armed', async () => {
    const { base } = await start()
    const response = await post({ base })
    expect(response.status).toBe(409)
  })

  it('hands the token over once while the window is open', async () => {
    const { base, pairing } = await start()
    pairing.arm()
    const first = await post({ base })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ token })
    expect((await post({ base })).status).toBe(409)
    expect(pairing.status().pairedAt).toBeDefined()
  })

  it('refuses another extension origin', async () => {
    const { base, pairing } = await start()
    pairing.arm()
    expect((await post({ base, requestOrigin: `chrome-extension://${'c'.repeat(32)}` })).status).toBe(403)
  })

  it('expires the window on its own', async () => {
    let clock = 1_000
    const pairing = createPairing({ token: () => token, now: () => clock, windowMs: 1_000 })
    pairing.arm()
    clock += 2_000
    expect(pairing.status().armed).toBe(false)
    expect(pairing.take()).toBeUndefined()
  })

  it('answers the extension preflight with CORS headers', async () => {
    const { base } = await start()
    const response = await fetch(base, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('marks the token response for the allowed origin', async () => {
    const { base, pairing } = await start()
    pairing.arm()
    const response = await post({ base })
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
  })
})
