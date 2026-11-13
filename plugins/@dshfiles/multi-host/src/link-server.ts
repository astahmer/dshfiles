import http from 'node:http'
import type { Duplex } from 'node:stream'
import { Option, Schema } from 'effect'

/** What `GET /link` answers, unauthenticated, so a pairing machine can tell a link gateway from any other listener. */
export const linkProtocol = { protocol: 'dsh-link', version: 1 } as const

export type RedeemAnswer =
  | { readonly ok: true; readonly credential: string; readonly runtimeId: string; readonly name: string }
  | { readonly ok: false; readonly status: number; readonly reason: string; readonly message: string }

export interface LinkServerOptions {
  /** Loopback port of this machine's native DSH listener. */
  readonly upstreamPort: number
  /** Per-runtime cookie name: every linked runtime shares the `127.0.0.1` cookie jar of the browser that opens it. */
  readonly cookieName: string
  /** The peer a credential belongs to, or undefined once it is revoked. */
  readonly authenticate: (credential: string) => { readonly id: string } | undefined
  readonly redeem: (input: { readonly code: string; readonly name: string; readonly runtimeId?: string }) => Promise<RedeemAnswer>
  /** The native listener's own authority-bound session cookie; undefined while it cannot be minted. */
  readonly nativeCookie: () => Promise<string | undefined>
  /** Drop a cached native cookie the native listener refused. */
  readonly nativeCookieRejected: (cookie: string) => void
}

const maxRedeemBytes = 2048
const credentialPattern = /^[A-Za-z0-9_-]{43}$/

const credentialOf = (input: { readonly header: string | undefined; readonly name: string }): string | undefined => {
  if (input.header === undefined) return undefined
  const values = input.header
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(`${input.name}=`))
    .map(part => part.slice(input.name.length + 1))
  const [only] = values
  return values.length === 1 && only !== undefined && credentialPattern.test(only) ? only : undefined
}

const json = (response: http.ServerResponse, status: number, body: Readonly<Record<string, string | number>>, headers: http.OutgoingHttpHeaders = {}): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

const redeemBodySchema = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(64)),
  name: Schema.String.check(Schema.isMaxLength(120)),
  runtimeId: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
})
const decodeRedeemBody = Schema.decodeUnknownOption(Schema.fromJsonString(redeemBodySchema))

const readBody = async (request: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('body is not binary')
    size += chunk.byteLength
    if (size > maxRedeemBytes) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A peer-facing gateway in front of the loopback-only native listener. A pairing code buys a credential; the
 * credential, presented once as `/?token=` like a native launch URL, becomes a per-runtime cookie; each request with
 * it is proxied to the native listener with the native session cookie and the native authority. The peer's own
 * cookies never reach the native listener, and the native listener's cookies never leave this machine.
 */
export const createLinkServer = (options: LinkServerOptions) => {
  const authority = `127.0.0.1:${options.upstreamPort}`
  const nativeOrigin = `http://${authority}`
  const active = new Map<string, Set<{ destroy: () => void }>>()

  const track = (credential: string, socket: { destroy: () => void }): (() => void) => {
    const sockets = active.get(credential) ?? new Set()
    sockets.add(socket)
    active.set(credential, sockets)
    return () => {
      sockets.delete(socket)
      if (sockets.size === 0) active.delete(credential)
    }
  }

  const rewrite = (headers: http.IncomingHttpHeaders, cookie: string): http.IncomingHttpHeaders => {
    const next: http.IncomingHttpHeaders = { ...headers, host: authority, cookie }
    if (typeof next.origin === 'string') next.origin = nativeOrigin
    if (typeof next.referer === 'string') {
      try {
        const referer = new URL(next.referer)
        next.referer = `${nativeOrigin}${referer.pathname}${referer.search}`
      } catch {
        delete next.referer
      }
    }
    return next
  }

  const authorised = (request: http.IncomingMessage): string | undefined => {
    const credential = credentialOf({ header: request.headers.cookie, name: options.cookieName })
    return credential !== undefined && options.authenticate(credential) !== undefined ? credential : undefined
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://link.invalid')

    if (url.pathname === '/link' && request.method === 'GET') return json(response, 200, linkProtocol)

    if (url.pathname === '/link/redeem') {
      if (request.method !== 'POST') return json(response, 405, { reason: 'invalid', message: 'Use POST.' })
      void readBody(request)
        .then(async body => {
          const decoded = decodeRedeemBody(body)
          if (Option.isNone(decoded)) return json(response, 400, { reason: 'invalid', message: 'The pairing request was malformed.' })
          const { code, name, runtimeId } = decoded.value
          const answer = await options.redeem({ code, name, ...(runtimeId !== undefined && { runtimeId }) })
          if (!answer.ok) return json(response, answer.status, { reason: answer.reason, message: answer.message })
          json(response, 200, { credential: answer.credential, runtimeId: answer.runtimeId, name: answer.name })
        })
        .catch(() => {
          if (!response.headersSent) json(response, 400, { reason: 'invalid', message: 'The pairing request was malformed.' })
        })
      return
    }

    // The launch exchange: the same shape a native launch URL has, so the multi-host gateway connects unchanged.
    const token = url.pathname === '/' ? url.searchParams.get('token') : null
    if (token !== null && request.method === 'GET') {
      if (!credentialPattern.test(token) || options.authenticate(token) === undefined) return json(response, 401, { reason: 'unknown', message: 'Not linked.' })
      response.writeHead(303, {
        location: '/',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${options.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}`,
      })
      response.end()
      return
    }

    const credential = authorised(request)
    if (credential === undefined) {
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('This machine is not linked here. Pair it again from Hosts → Pair a machine.\n')
      return
    }

    void options.nativeCookie().then(cookie => {
      if (cookie === undefined) return json(response, 503, { reason: 'no-runtime', message: 'DSH on this machine is not serving yet.' })
      const outgoing = http.request(
        { hostname: '127.0.0.1', port: options.upstreamPort, method: request.method, path: request.url, headers: rewrite(request.headers, cookie) },
        incoming => {
          if (incoming.statusCode === 401 || incoming.statusCode === 403) options.nativeCookieRejected(cookie)
          const headers = { ...incoming.headers }
          delete headers['set-cookie']
          response.writeHead(incoming.statusCode ?? 502, headers)
          incoming.pipe(response)
        },
      )
      const untrack = track(credential, outgoing)
      response.once('close', untrack)
      outgoing.on('error', () => {
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
        response.end('upstream unavailable')
      })
      request.pipe(outgoing)
    })
  })

  server.on('upgrade', (request, socket: Duplex, head: Buffer) => {
    const credential = authorised(request)
    if (credential === undefined) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    let closed = false
    let upstream: Duplex | undefined
    const untrackSocket = track(credential, socket)
    const teardown = (): void => {
      if (closed) return
      closed = true
      untrackSocket()
      socket.destroy()
      upstream?.destroy()
    }
    socket.once('close', teardown)
    socket.on('error', teardown)
    void options.nativeCookie().then(cookie => {
      if (cookie === undefined || closed) return teardown()
      const outgoing = http.request({
        hostname: '127.0.0.1',
        port: options.upstreamPort,
        method: request.method,
        path: request.url,
        headers: rewrite(request.headers, cookie),
      })
      outgoing.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
        upstream = upstreamSocket
        if (closed) return teardown()
        const headers = Object.entries(incoming.headers)
          .filter(([name]) => name !== 'set-cookie')
          .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`))
          .join('\r\n')
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`)
        if (upstreamHead.length > 0) socket.write(upstreamHead)
        if (head.length > 0) upstreamSocket.write(head)
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
        upstreamSocket.once('close', teardown)
        upstreamSocket.on('error', teardown)
      })
      outgoing.on('response', incoming => {
        if (incoming.statusCode === 401 || incoming.statusCode === 403) options.nativeCookieRejected(cookie)
        incoming.resume()
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      })
      outgoing.on('error', teardown)
      outgoing.end()
    })
  })

  return {
    server,
    /** Close every open request and socket whose credential no longer authenticates. */
    closeUnauthorised: (): void => {
      for (const [credential, sockets] of active) {
        if (options.authenticate(credential) !== undefined) continue
        for (const socket of sockets) socket.destroy()
        active.delete(credential)
      }
    },
    closeAll: (): void => {
      for (const sockets of active.values()) for (const socket of sockets) socket.destroy()
      active.clear()
      server.closeAllConnections()
    },
  }
}
