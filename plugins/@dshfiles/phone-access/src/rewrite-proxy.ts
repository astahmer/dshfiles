import { withSpan } from '@dshfiles/dshx/tracing'
import http from 'node:http'
import type { Duplex } from 'node:stream'

/** Routes another Host plugin owns on this proxy's public origin (phone-pairing's `/pair` and device cookie). */
export interface RouteClaim {
  readonly owner: string
  /** Loopback port the claimed requests go to, with their headers unchanged. */
  readonly port: number
  readonly pathPrefixes: readonly string[]
  readonly cookie?: string | undefined
  /** Where a signed-out phone can sign in on these routes, offered on the signed-out page. */
  readonly signIn?: { readonly path: string; readonly label: string } | undefined
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/gu, character => `&#${String(character.codePointAt(0))};`)

/** A top-level page load (not a fetch, script or socket): only those get the signed-out page instead of a bare 401. */
const isPageLoad = (request: Pick<http.IncomingMessage, 'method' | 'headers'>): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const dest = request.headers['sec-fetch-dest']
  if (typeof dest === 'string') return dest === 'document'
  return (request.headers.accept ?? '').includes('text/html')
}

/**
 * What a phone sees when it opens this origin signed out: the two ways in, instead of the native listener's
 * "reopen the URL printed by dsh web".
 */
const signedOutPage = (claims: readonly RouteClaim[]): string => {
  const links = claims.flatMap(claim =>
    claim.signIn === undefined ? [] : [`<a class="action" href="${escapeHtml(claim.signIn.path)}">${escapeHtml(claim.signIn.label)}</a>`],
  )
  const pairing = links.length === 0 ? '' : '<p>Or pair it with a code from Pair a phone on your computer:</p>'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sign in to DSH</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:3rem 1.25rem;max-width:26rem;margin-inline:auto}.action{display:block;box-sizing:border-box;margin-top:1rem;padding:.75rem 1.25rem;min-height:44px;text-align:center;border-radius:.5rem;border:1px solid currentColor;color:inherit;text-decoration:none}</style>
</head><body><main><h1>Sign in to DSH on this phone</h1><p role="alert">This phone is not signed in to this DSH.</p><p>Scan the phone sign-in QR code that DSH printed in its terminal when it started.</p>${pairing}${links.join('')}</main></body></html>`
}

const cookieNames = (header: string | undefined): readonly string[] =>
  header === undefined ? [] : header.split(';').map(part => part.trim().split('=')[0] ?? '')

const pathOf = (url: string | undefined): string => {
  try {
    return new URL(url ?? '/', 'http://proxy.invalid').pathname
  } catch {
    return '/'
  }
}

/** The claim a request belongs to: a claimed path (`/pair` or below it) or the claimer's cookie. */
export const claimFor = (claims: readonly RouteClaim[], request: Pick<http.IncomingMessage, 'url' | 'headers'>): RouteClaim | undefined => {
  const path = pathOf(request.url)
  const names = cookieNames(request.headers.cookie)
  return claims.find(
    claim =>
      claim.pathPrefixes.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) ||
      (claim.cookie !== undefined && names.includes(claim.cookie)),
  )
}

const pipeUpgrade = (socket: Duplex, head: Buffer, outgoing: http.ClientRequest): void => {
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
  outgoing.on('response', incoming => {
    incoming.resume()
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  outgoing.on('error', () => socket.destroy())
  socket.on('error', () => outgoing.destroy())
  outgoing.end()
}

/**
 * Loopback reverse proxy for a TLS-terminating front (Tailscale Serve or Funnel).
 *
 * The native listener authenticates browsers by *authority*: the Host/Origin fence
 * and the cookie name both encode the authority the request claims. A tunnel
 * forwards the public Host, which the loopback listener rejects. Rewriting Host and
 * Origin to the loopback authority keeps the browser on the public origin while the
 * native listener mints and checks its own authority-bound cookie, so no
 * `trustedHosts` configuration is needed.
 *
 * Claimed routes (`claims`) go to their owner's loopback port unchanged instead: the owner does its own
 * authentication and rewriting, on the same public origin the phone already uses.
 */
export const createRewriteProxy = ({
  upstream,
  port,
  claims = () => [],
}: {
  readonly upstream: number
  readonly port: number
  readonly claims?: () => readonly RouteClaim[]
}) => {
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

  /** Where a request goes: a claimer's port with its headers as sent, or the native listener with Host/Origin rewritten. */
  const target = (request: http.IncomingMessage): { readonly port: number; readonly headers: http.IncomingHttpHeaders } => {
    const claim = claimFor(claims(), request)
    return claim === undefined ? { port: upstream, headers: rewrite(request.headers) } : { port: claim.port, headers: request.headers }
  }

  const server = http.createServer((request, response) => {
    const to = target(request)
    const outgoing = http.request({ hostname: '127.0.0.1', port: to.port, method: request.method, path: request.url, headers: to.headers }, incoming => {
      if (incoming.statusCode === 401 && to.port === upstream && isPageLoad(request)) {
        incoming.resume()
        response.writeHead(401, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        })
        response.end(request.method === 'HEAD' ? undefined : signedOutPage(claims()))
        return
      }
      response.writeHead(incoming.statusCode ?? 502, incoming.headers)
      incoming.pipe(response)
    })
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('upstream unavailable')
    })
    request.pipe(outgoing)
  })

  server.on('upgrade', (request, socket, head) => {
    const to = target(request)
    pipeUpgrade(socket, head, http.request({ hostname: '127.0.0.1', port: to.port, method: request.method, path: request.url, headers: to.headers }))
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
