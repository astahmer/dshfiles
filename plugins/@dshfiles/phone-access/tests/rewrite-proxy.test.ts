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
