import http from 'node:http'
import type { Duplex } from 'node:stream'

const COOKIE = '__Host-dsh_phone'

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair phone</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:3rem 1.25rem;max-width:26rem;margin-inline:auto}input{font:inherit;letter-spacing:.4em;padding:.75rem;width:100%;box-sizing:border-box;text-align:center}button{font:inherit;margin-top:1rem;padding:.75rem 1.25rem;width:100%}#status{margin-top:1rem}</style>
</head><body><main><h1>Pair this phone</h1><p id="status" role="status">Enter the 6-digit code shown in the DSH terminal.</p>
<form id="form"><input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button type="submit">Pair</button></form></main>
<script src="/pair/landing.js" defer></script></body></html>`

const script = `(() => {
  const status = document.querySelector('#status')
  const form = document.querySelector('#form')
  const input = document.querySelector('#code')
  const fragment = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const parameters = new URLSearchParams(fragment)
  const id = parameters.get('id')
  const secret = parameters.get('secret')
  const done = response => {
    if (!response.ok) { status.textContent = 'That code is not valid any more. Ask DSH for a new one.'; return }
    status.textContent = 'Paired. Opening DSH…'
    location.assign('/')
  }
  const submit = body => fetch('/pair/redeem', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(done).catch(() => { status.textContent = 'Pairing failed. Try again.' })
  if (id && secret && [...parameters.keys()].sort().join(',') === 'id,secret') { submit({ id, secret }); return }
  form.addEventListener('submit', event => { event.preventDefault(); if (/^[0-9]{6}$/.test(input.value)) submit({ code: input.value }) })
})()`

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

export interface NativeCookie {
  readonly value: string
  readonly expiresAt: number
}

/** Exchange the native launch URL for its session cookie; the redirect body is never read. */
export const mintNativeCookie = async (url: string): Promise<NativeCookie | undefined> => {
  const response = await fetch(url, { redirect: 'manual' })
  await response.body?.cancel()
  const header = response.headers.get('set-cookie')
  const value = header?.split(';')[0]
  if (header === null || value === undefined || value === '') return undefined
  const maxAge = /;\s*max-age=(\d+)/i.exec(header)?.[1]
  return { value, expiresAt: maxAge === undefined ? Number.POSITIVE_INFINITY : Date.now() + Number(maxAge) * 1_000 }
}

export interface GatewayOptions {
  /** Loopback port of the native listener. */
  readonly upstream: number
  /** Loopback port the tunnel targets. */
  readonly port: number
  readonly store: {
    redeem: (input: {
      readonly id?: string
      readonly secret?: string
      readonly code?: string
      readonly name?: string
    }) => Promise<{ deviceId: string; token: string } | undefined>
    authenticate: (credential: string) => { deviceId: string; expiresAt: number } | undefined
    listDevices: () => { id: string }[]
  }
  /** Public origin the phone uses, for cookie bounds and the landing redirect. */
  readonly publicOrigin?: string
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

  const readBody = async (request: http.IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += (chunk as Buffer).byteLength
      if (size > 1024) throw new Error('body too large')
      chunks.push(chunk as Buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  const respond = (response: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders = {}): void => {
    response.writeHead(status, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', ...headers })
    response.end()
  }

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
    const publicOrigin = options.publicOrigin

    if (url.pathname === '/pair' || url.pathname === '/pair/landing.js') {
      const body = url.pathname === '/pair' ? page : script
      response.writeHead(200, {
        'content-type': url.pathname === '/pair' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      })
      response.end(body)
      return
    }

    if (url.pathname === '/pair/redeem') {
      if (request.method !== 'POST' || !limited(request)) return respond(response, 405)
      void readBody(request)
        .then(async body => {
          if (typeof body !== 'object' || body === null) return respond(response, 400)
          const fields = Object.keys(body).sort().join(',')
          if (fields !== 'code' && fields !== 'id,secret') return respond(response, 400)
          const input = body as { id?: string; secret?: string; code?: string }
          const paired = await options.store.redeem(input)
          if (paired === undefined) return respond(response, 403)
          const maxAge = 365 * 24 * 3600
          respond(response, 303, {
            location: '/',
            'set-cookie': `${COOKIE}=${paired.token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`,
          })
        })
        .catch(() => respond(response, 400))
      return
    }

    const credential = authorised(request)
    if (credential === undefined) {
      response.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      response.end('Pair this device at /pair\n')
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
    /** Close sockets whose device credential no longer authenticates (revocation). */
    closeUnauthorised: (): void => {
      for (const entry of active) if (options.store.authenticate(entry.credential) === undefined) closeCredential(entry.credential)
    },
    closeAll: (): void => {
      for (const entry of active) for (const socket of entry.sockets) socket.destroy()
      active.clear()
    },
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      }),
  }
}

/** Cookie name is fixed; exported for tests that assert the attribute string. */
export const pairingCookieName = COOKIE
