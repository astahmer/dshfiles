import http from 'node:http'
import type { Duplex } from 'node:stream'
import { decodeJson, type JsonObject, type JsonValue, jsonValueSchema } from '@dshfiles/dshx/json'
import { withSpan } from '@dshfiles/dshx/tracing'
import { type GatewayRefusal, landingScript, pairedPage, pairPage, refusalMessage, refusalStatus, unpairedPage, wantsPage } from './landing.ts'
import type { NativeCookie } from './native-cookie.ts'
import type { RedeemResult } from './store.ts'

const COOKIE = '__Host-dsh_phone'

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const cookieOf = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined
  const values = header
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(`${COOKIE}=`))
  const [only] = values
  if (values.length !== 1 || only === undefined) return undefined
  return only.slice(COOKIE.length + 1)
}

export interface GatewayOptions {
  /** Loopback port of the native listener. */
  readonly upstream: number
  /** Loopback port the tunnel targets. */
  readonly port: number
  readonly store: {
    attempt: (input: { readonly id?: string; readonly secret?: string; readonly code?: string; readonly name?: string }) => Promise<RedeemResult>
    authenticate: (credential: string) => { deviceId: string; expiresAt: number } | undefined
    listDevices: () => { id: string }[]
  }
  /**
   * Public origin the phone uses, for cookie bounds and the landing redirect. A getter when the gateway binds before
   * the tunnel that names the origin exists (bind first, so a busy port never starts a tunnel).
   */
  readonly publicOrigin?: string | (() => string | undefined)
  /** The native listener needs its own authority-bound session cookie; minted once, re-minted near expiry or on 401/403. */
  readonly nativeCookie: () => Promise<NativeCookie | undefined>
}

/**
 * Phone-facing gateway: pairing endpoints, a persistent device cookie, and a proxy to the
 * native listener that rewrites Host/Origin to the loopback authority (native auth is
 * authority-bound). Loopback only; the tunnel is the sole public entry point.
 */
export const createPairingGateway = (options: GatewayOptions) => {
  const authority = `127.0.0.1:${options.upstream}`
  const nativeOrigin = `http://${authority}`
  const active = new Set<{ credential: string; sockets: Set<{ destroy: () => void }> }>()
  const closeCredential = (credential: string): void => {
    for (const entry of active) {
      if (entry.credential !== credential) continue
      for (const socket of entry.sockets) socket.destroy()
      active.delete(entry)
    }
  }

  let minted: NativeCookie | undefined
  let minting: Promise<string | undefined> | undefined
  const nativeCookie = (): Promise<string | undefined> => {
    if (minted !== undefined && minted.expiresAt - 60_000 > Date.now()) return Promise.resolve(minted.value)
    minting ??= options
      .nativeCookie()
      .catch(() => undefined)
      .then(next => {
        minted = next
        minting = undefined
        return next?.value
      })
    return minting
  }
  const rejectedBy = (status: number | undefined, cookie: string): void => {
    if ((status === 401 || status === 403) && minted?.value === cookie) minted = undefined
  }

  const authorised = (request: http.IncomingMessage): string | undefined => {
    const credential = cookieOf(request.headers.cookie)
    if (credential === undefined) return undefined
    return options.store.authenticate(credential) === undefined ? undefined : credential
  }

  const limited = (request: http.IncomingMessage): boolean => {
    if (request.method !== 'POST') return true
    const length = request.headers['content-length']
    return length === undefined || Number(length) <= 1024
  }

  const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

  const readBody = async (request: http.IncomingMessage): Promise<JsonValue> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      if (!Buffer.isBuffer(chunk)) throw new Error('body is not binary')
      size += chunk.byteLength
      if (size > 1024) throw new Error('body too large')
      chunks.push(chunk)
    }
    return decodeJson(jsonValueSchema, Buffer.concat(chunks).toString('utf8'))
  }

  const respond = (response: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders = {}): void => {
    response.writeHead(status, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', ...headers })
    response.end()
  }

  const html = (response: http.ServerResponse, status: number, body: string): void => {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': PAGE_CSP,
    })
    response.end(body)
  }

  /**
   * The redeem answer is JSON, never a redirect: the page's `fetch` cannot follow a 303 to the app, and it
   * treated the 303 as a failure after the cookie was already set, so the phone read "failed" and a retyped code
   * "not valid".
   */
  const json = (
    response: http.ServerResponse,
    status: number,
    body: Readonly<Record<string, string | boolean>>,
    headers: http.OutgoingHttpHeaders = {},
  ): void => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...headers,
    })
    response.end(JSON.stringify(body))
  }
  const refuse = (response: http.ServerResponse, reason: GatewayRefusal): void =>
    json(response, refusalStatus(reason), { paired: false, reason, message: refusalMessage[reason] })

  const rewrite = (headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders => {
    const next: http.IncomingHttpHeaders = { ...headers, host: authority }
    delete next.cookie
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

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://gateway.invalid')
    const publicOrigin = typeof options.publicOrigin === 'function' ? options.publicOrigin() : options.publicOrigin

    if (url.pathname === '/pair') return html(response, 200, authorised(request) === undefined ? pairPage : pairedPage)

    if (url.pathname === '/pair/landing.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': PAGE_CSP,
      })
      response.end(landingScript)
      return
    }

    if (url.pathname === '/pair/redeem') {
      if (request.method !== 'POST' || !limited(request)) return respond(response, 405)
      // A phone that already paired (it scanned the QR, then typed the same code) keeps its cookie and spends no offer.
      if (authorised(request) !== undefined) {
        request.resume()
        return json(response, 200, { paired: true, already: true, message: 'This phone is already paired. Opening DSH…' })
      }
      void readBody(request)
        .then(async body => {
          if (!isJsonObject(body)) return refuse(response, 'invalid')
          const fields = Object.keys(body).sort().join(',')
          const { id, secret, code } = body
          const input =
            fields === 'code' && typeof code === 'string'
              ? { code }
              : fields === 'id,secret' && typeof id === 'string' && typeof secret === 'string'
                ? { id, secret }
                : undefined
          if (input === undefined) return refuse(response, 'invalid')
          const result = await options.store.attempt(input)
          if (!result.ok) return refuse(response, result.reason)
          const maxAge = 365 * 24 * 3600
          json(
            response,
            200,
            { paired: true, message: 'Paired. Opening DSH…' },
            {
              'set-cookie': `${COOKIE}=${result.token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`,
            },
          )
        })
        .catch(() => refuse(response, 'invalid'))
      return
    }

    const credential = authorised(request)
    if (credential === undefined) {
      // A page load gets a way back in; a fetch or script gets a plain 401 it can act on.
      if (wantsPage(request.headers, request.method)) return html(response, 401, unpairedPage)
      response.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      response.end('This phone is not paired any more. Open /pair to pair it again.\n')
      return
    }

    void nativeCookie().then(cookie => {
      if (cookie === undefined) {
        respond(response, 503)
        return
      }
      const headers = rewrite(request.headers)
      headers.cookie = cookie
      const entry = { credential, sockets: new Set<{ destroy: () => void }>() }
      active.add(entry)
      response.once('close', () => active.delete(entry))
      const outgoing = http.request({ hostname: '127.0.0.1', port: options.upstream, method: request.method, path: request.url, headers }, incoming => {
        rejectedBy(incoming.statusCode, cookie)
        const passthrough = { ...incoming.headers }
        delete passthrough['set-cookie']
        response.writeHead(incoming.statusCode ?? 502, passthrough)
        incoming.pipe(response)
      })
      entry.sockets.add(outgoing)
      outgoing.on('error', () => {
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
        response.end('upstream unavailable')
      })
      request.pipe(outgoing)
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const credential = authorised(request)
    if (credential === undefined) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    const entry = { credential, sockets: new Set<{ destroy: () => void }>() }
    active.add(entry)
    let closed = false
    let upstream: Duplex | undefined
    const teardown = (): void => {
      if (closed) return
      closed = true
      active.delete(entry)
      socket.destroy()
      for (const peer of entry.sockets) peer.destroy()
    }
    socket.once('close', teardown)
    socket.on('error', teardown)
    socket.once('end', () => (upstream === undefined ? teardown() : upstream.end(teardown)))
    void nativeCookie().then(cookie => {
      if (cookie === undefined || closed) return teardown()
      const headers = rewrite(request.headers)
      headers.cookie = cookie
      const outgoing = http.request({ hostname: '127.0.0.1', port: options.upstream, method: request.method, path: request.url, headers })
      entry.sockets.add(outgoing)
      outgoing.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
        upstream = upstreamSocket
        entry.sockets.add(upstreamSocket)
        const headers = Object.entries(incoming.headers)
          .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`))
          .join('\r\n')
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`)
        if (upstreamHead.length > 0) socket.write(upstreamHead)
        if (head.length > 0) upstreamSocket.write(head)
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
        upstreamSocket.once('close', teardown)
        upstreamSocket.on('error', teardown)
        upstreamSocket.once('end', () => socket.end(teardown))
      })
      outgoing.on('response', incoming => {
        rejectedBy(incoming.statusCode, cookie)
        incoming.resume()
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      })
      outgoing.on('error', teardown)
      outgoing.end()
    })
  })

  return {
    server,
    /** The bound port once listening: the OS picks one when asked for 0 (behind phone-access's proxy). */
    port: (): number | undefined => {
      const address = server.address()
      return address === null || !(address instanceof Object) ? undefined : address.port
    },
    /** Close sockets whose device credential no longer authenticates (revocation). */
    closeUnauthorised: (): void => {
      for (const entry of active) if (options.store.authenticate(entry.credential) === undefined) closeCredential(entry.credential)
    },
    closeAll: (): void => {
      for (const entry of active) for (const socket of entry.sockets) socket.destroy()
      active.clear()
    },
    listen: () =>
      withSpan(
        'phone pairing gateway listen',
        () =>
          new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(options.port, '127.0.0.1', () => {
              server.off('error', reject)
              resolve()
            })
          }),
      ),
  }
}

/** Cookie name is fixed; exported for tests that assert the attribute string. */
export const pairingCookieName = COOKIE
