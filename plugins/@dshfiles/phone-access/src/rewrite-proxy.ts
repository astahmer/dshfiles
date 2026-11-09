import { withSpan } from '@dshfiles/dshx/tracing'
import http from 'node:http'

/**
 * Loopback reverse proxy for a TLS-terminating front (Tailscale Serve or Funnel).
 *
 * The native listener authenticates browsers by *authority*: the Host/Origin fence
 * and the cookie name both encode the authority the request claims. A tunnel
 * forwards the public Host, which the loopback listener rejects. Rewriting Host and
 * Origin to the loopback authority keeps the browser on the public origin while the
 * native listener mints and checks its own authority-bound cookie, so no
 * `trustedHosts` configuration is needed.
 */
export const createRewriteProxy = ({ upstream, port }: { readonly upstream: number; readonly port: number }) => {
  if (!Number.isSafeInteger(upstream) || upstream < 1 || upstream > 65_535) throw new Error('Invalid upstream port')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid proxy port')
  const authority = `127.0.0.1:${upstream}`
  const origin = `http://${authority}`

  const rewrite = (headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders => {
    const next: http.IncomingHttpHeaders = { ...headers, host: authority }
    if (typeof next.origin === 'string') next.origin = origin
    if (typeof next.referer === 'string') {
      try {
        const referer = new URL(next.referer)
        next.referer = `${origin}${referer.pathname}${referer.search}`
      } catch {
        delete next.referer
      }
    }
    return next
  }

  const server = http.createServer((request, response) => {
    const outgoing = http.request(
      { hostname: '127.0.0.1', port: upstream, method: request.method, path: request.url, headers: rewrite(request.headers) },
      incoming => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers)
        incoming.pipe(response)
      },
    )
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('upstream unavailable')
    })
    request.pipe(outgoing)
  })

  server.on('upgrade', (request, socket, head) => {
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port: upstream,
      method: request.method,
      path: request.url,
      headers: rewrite(request.headers),
    })
    outgoing.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
      const headers = Object.entries(incoming.headers)
        .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`))
        .join('\r\n')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
      upstreamSocket.on('error', () => socket.destroy())
      upstreamSocket.on('close', () => socket.destroy())
    })
    outgoing.on('response', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'))
    outgoing.on('error', () => socket.destroy())
    socket.on('error', () => outgoing.destroy())
    outgoing.end()
  })

  return {
    server,
    /** Bind loopback only: the tunnel is the sole public entry point. */
    listen: () =>
      withSpan('phone access proxy listen', async () => {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
          })
        })
      }),
  }
}
