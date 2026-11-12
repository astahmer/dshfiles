import http from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { claimFor, createRewriteProxy, type RouteClaim } from '../src/rewrite-proxy.ts'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

const serve = async (name: string, seen: { name: string; host?: string; path?: string }[]): Promise<number> => {
  const server = http.createServer((incoming, response) => {
    seen.push({ name, host: incoming.headers.host, path: incoming.url })
    response.end(name)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  closers.push(() => new Promise(resolve => server.close(() => resolve())))
  const address = server.address()
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

const freePort = async (): Promise<number> => {
  const server = http.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  await new Promise(resolve => server.close(resolve))
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

const get = (port: number, path: string, headers: http.OutgoingHttpHeaders) =>
  new Promise<string>((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path, headers }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => (body += chunk))
      response.on('end', () => resolve(body))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })

const pairing: RouteClaim = { owner: '@dshfiles/phone-pairing', port: 1, pathPrefixes: ['/pair'], cookie: '__Host-dsh_phone' }

describe('phone edge route claims', () => {
  it('matches a claimed path, the paths below it and the claimed cookie, nothing else', () => {
    const claim = (url: string, cookie?: string) => claimFor([pairing], { url, headers: cookie === undefined ? {} : { cookie } })?.owner
    expect(claim('/pair')).toBe('@dshfiles/phone-pairing')
    expect(claim('/pair/redeem')).toBe('@dshfiles/phone-pairing')
    expect(claim('/pairing')).toBeUndefined()
    expect(claim('/threads')).toBeUndefined()
    expect(claim('/threads', 'a=1; __Host-dsh_phone=token')).toBe('@dshfiles/phone-pairing')
    expect(claim('/threads', 'x__Host-dsh_phone=1')).toBeUndefined()
  })

  it('sends claimed requests to the claimer unchanged and every other request to DSH with the loopback Host', async () => {
    const seen: { name: string; host?: string; path?: string }[] = []
    const native = await serve('native', seen)
    const claimer = await serve('pairing', seen)
    const claims: RouteClaim[] = []
    const port = await freePort()
    const proxy = createRewriteProxy({ upstream: native, port, claims: () => claims })
    await proxy.listen()
    closers.push(() => new Promise(resolve => proxy.server.close(() => resolve())))
    const host = { host: 'machine.example.ts.net' }

    expect(await get(port, '/pair', host)).toBe('native')
    claims.push({ ...pairing, port: claimer })
    expect(await get(port, '/pair', host)).toBe('pairing')
    expect(await get(port, '/threads', { ...host, cookie: '__Host-dsh_phone=device' })).toBe('pairing')
    expect(await get(port, '/threads', host)).toBe('native')
    claims.length = 0
    expect(await get(port, '/pair/redeem', host)).toBe('native')

    expect(seen.find(entry => entry.name === 'pairing')?.host).toBe('machine.example.ts.net')
    expect(seen.filter(entry => entry.name === 'native').every(entry => entry.host === `127.0.0.1:${String(native)}`)).toBe(true)
  })
})
