import { createConnection, createServer, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { Effect } from 'effect'
import { LinkCredentialMissing, LoopbackForwardUnavailable } from '../errors.js'
import { LinkStore } from '../link-store.js'
import { connectGateway } from './gateway.js'
import { Loopback } from './loopback.js'

/** How a link URL protects the credential on the wire. */
export type LinkTransport = 'tls' | 'tailnet' | 'loopback' | 'plain'

const isTailnetHost = (host: string): boolean => {
  const parts = host.split('.').map(Number)
  if (parts.length === 4 && parts.every(part => Number.isInteger(part))) return parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127
  return host.endsWith('.ts.net') || host.toLowerCase().startsWith('fd7a:115c:a1e0:')
}

export const linkTransport = (url: string): LinkTransport => {
  const parsed = new URL(url)
  if (parsed.protocol === 'https:') return 'tls'
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return 'loopback'
  return isTailnetHost(host) ? 'tailnet' : 'plain'
}

/**
 * A loopback listener piping each socket to the peer's link gateway, through TLS for an `https:` origin. The gateway
 * above it then talks plain HTTP to `127.0.0.1`, the way it talks to every other runtime.
 */
const forward = Effect.fn('multi-host link forward')(function* (input: { readonly url: string; readonly originPort?: number | undefined }) {
  const target = new URL(input.url)
  const secure = target.protocol === 'https:'
  const host = target.hostname.replace(/^\[|\]$/g, '')
  const port = target.port === '' ? (secure ? 443 : 80) : Number(target.port)
  const sockets = new Set<Socket>()
  const server = createServer(client => {
    const upstream = secure ? tlsConnect({ host, port, servername: host }) : createConnection({ host, port })
    client.once('error', () => upstream.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
    upstream.once('close', () => client.destroy())
    upstream.once(secure ? 'secureConnect' : 'connect', () => {
      if (client.destroyed) return upstream.destroy()
      client.pipe(upstream).pipe(client)
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const endpoint = yield* Loopback.reserve(input.originPort ?? 0).pipe(Effect.mapError(() => new LoopbackForwardUnavailable()))
  yield* Effect.acquireRelease(
    Effect.callback<void, LoopbackForwardUnavailable>(resume => {
      server.once('error', () => resume(Effect.fail(new LoopbackForwardUnavailable())))
      server.listen({ host: endpoint.address, port: endpoint.port }, () => resume(Effect.void))
    }),
    () =>
      Effect.callback<void>(resume => {
        for (const socket of sockets) socket.destroy()
        if (!server.listening) return resume(Effect.void)
        server.close(() => resume(Effect.void))
      }),
  )
  return endpoint
})

/** A paired runtime: the stored credential stands in for the launch token, exchanged by the peer's link gateway. */
export const connectDirect = Effect.fnUntraced(function* (input: { readonly url: string; readonly originPort?: number | undefined }) {
  const store = yield* LinkStore
  const credential = yield* store.credentialFor(input.url)
  if (credential === undefined) return yield* new LinkCredentialMissing()
  const openForward = forward({ url: input.url, originPort: input.originPort })
  const endpoint = yield* input.originPort === undefined
    ? openForward.pipe(Effect.retry({ times: 2, while: error => error._tag === 'LoopbackForwardUnavailable' }))
    : openForward
  const launchUrl = `http://${endpoint.address}:${endpoint.port}/?token=${encodeURIComponent(credential)}`
  return yield* connectGateway({
    launchUrl,
    transport: () => Effect.succeed({ origin: `http://${endpoint.address}:${endpoint.port}`, launchUrl, closed: Effect.never }),
  })
})
