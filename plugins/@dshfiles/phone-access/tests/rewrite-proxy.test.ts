import http from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { createRewriteProxy } from '../src/rewrite-proxy.ts'

const listen = async (server: http.Server): Promise<number> => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

const request = (port: number, headers: http.OutgoingHttpHeaders) =>
  new Promise<string>((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path: '/probe', headers }, response => {
      response.resume()
      response.on('end', () => resolve(`${response.statusCode}`))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })

describe('createRewriteProxy', () => {
  it('rewrites Host and Origin to the loopback authority', async () => {
    const seen: http.IncomingHttpHeaders[] = []
    const upstream = http.createServer((incoming, response) => {
      seen.push(incoming.headers)
      response.end('ok')
    })
    const upstreamPort = await listen(upstream)
    const reservation = http.createServer()
    const proxyPort = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const proxy = createRewriteProxy({ upstream: upstreamPort, port: proxyPort })
    await proxy.listen()
    const status = await request(proxyPort, { host: 'phone.example', origin: 'https://phone.example', referer: 'https://phone.example/threads?x=1' })
    expect(status).toBe('200')
    expect(seen[0]?.host).toBe(`127.0.0.1:${upstreamPort}`)
    expect(seen[0]?.origin).toBe(`http://127.0.0.1:${upstreamPort}`)
    expect(seen[0]?.referer).toBe(`http://127.0.0.1:${upstreamPort}/threads?x=1`)
    await new Promise(resolve => proxy.server.close(resolve))
    await new Promise(resolve => upstream.close(resolve))
  })

  it('rejects invalid ports', () => {
    expect(() => createRewriteProxy({ upstream: 0, port: 3443 })).toThrow(/upstream/)
    expect(() => createRewriteProxy({ upstream: 3080, port: 70_000 })).toThrow(/proxy/)
  })
})

describe('proxy listen span', () => {
  it('records one bounded listen span without addresses', async () => {
    using recorder = recordSpans()
    const proxy = createRewriteProxy({ upstream: 3080, port: 3446 })
    await proxy.listen()
    await new Promise(resolve => proxy.server.close(resolve))
    expect(recorder.named('phone access proxy listen')).toHaveLength(1)
    const metadata = JSON.stringify(recorder.spans.map(span => ({ attributes: span.attributes, status: span.status })))
    expect(metadata).not.toContain('127.0.0.1')
    expect(metadata).not.toContain('3446')
  })
})

describe('signed-out phone', () => {
  const fetchRaw = (port: number, path: string, headers: http.OutgoingHttpHeaders) =>
    new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
      const outgoing = http.request({ hostname: '127.0.0.1', port, path, headers }, response => {
        let body = ''
        response.on('data', chunk => (body += String(chunk)))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, type: String(response.headers['content-type'] ?? ''), body }))
      })
      outgoing.on('error', reject)
      outgoing.end()
    })

  it('answers a signed-out page load with both ways in, and leaves API 401s alone', async () => {
    const upstream = http.createServer((_incoming, response) => {
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
    })
    const upstreamPort = await listen(upstream)
    const reservation = http.createServer()
    const proxyPort = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const claims = [{ owner: '@dshfiles/phone-pairing', port: 1, pathPrefixes: ['/pair'], signIn: { path: '/pair', label: 'Pair <this> phone' } }]
    const proxy = createRewriteProxy({ upstream: upstreamPort, port: proxyPort, claims: () => claims })
    await proxy.listen()
    try {
      // Before this fix the phone read native's text/plain "reopen the URL printed by dsh web" with no way forward.
      const page = await fetchRaw(proxyPort, '/', { host: 'phone.example', accept: 'text/html', 'sec-fetch-dest': 'document' })
      expect(page.status).toBe(401)
      expect(page.type).toContain('text/html')
      expect(page.body).toContain('Sign in to DSH on this phone')
      expect(page.body).toContain('href="/pair">Pair &#60;this&#62; phone</a>')
      const api = await fetchRaw(proxyPort, '/api/state', { host: 'phone.example', accept: '*/*', 'sec-fetch-dest': 'empty' })
      expect(api.status).toBe(401)
      expect(api.type).toContain('text/plain')
      claims.length = 0
      expect((await fetchRaw(proxyPort, '/', { host: 'phone.example', accept: 'text/html' })).body).not.toContain('href="/pair"')
    } finally {
      await new Promise(resolve => proxy.server.close(resolve))
      await new Promise(resolve => upstream.close(resolve))
    }
  })
})
