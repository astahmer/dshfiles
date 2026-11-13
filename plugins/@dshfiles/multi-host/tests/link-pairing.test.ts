import { once } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Exit, Layer, ManagedRuntime, Path, Schema, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { WebSocketServer } from 'ws'
import { afterEach, describe, expect, test } from 'vitest'
import { connectDirect, linkTransport } from '../src/connectors/direct.js'
import { LinkPlan } from '../src/link-gateway.js'
import { redeemPairingCode } from '../src/link-pairing.js'
import { createLinkServer } from '../src/link-server.js'
import { LinkStore } from '../src/link-store.js'
import { MultiHostPaths } from '../src/paths.js'

const addressSchema = Schema.Struct({ port: Schema.Number })
const requestSchema = Schema.fromJsonString(Schema.Struct({ rpcId: Schema.String }))
const portOf = (server: Server): number => Schema.decodeUnknownSync(addressSchema)(server.address()).port

const nativeToken = 'native-token-12345678'
const peerRuntimeId = '6f1f3c0e-1c1a-4f7e-9a4b-2a0c6c4f9d11'
const pairingRuntimeId = '0b6f7f1e-58f4-4a3a-8f4e-3c1f2b7d9e20'

/** A native DSH listener: its launch exchange, one RPC that echoes the authority it saw, and a mux socket. */
const startNative = async () => {
  const seen = { cookies: new Array<string | undefined>() }
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === `/?token=${nativeToken}`) {
      response.writeHead(302, { location: '/', 'set-cookie': 'dsh_session=native; HttpOnly' }).end()
      return
    }
    seen.cookies.push(request.headers.cookie)
    if (request.headers.cookie !== 'dsh_session=native') {
      response.writeHead(401).end()
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const input = Schema.decodeUnknownSync(requestSchema)(body)
      response
        .writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh_session=rotated' })
        .end(JSON.stringify({ type: 'server-response', rpcId: input.rpcId, result: { ok: true, value: { host: request.headers.host } } }))
    })
  })
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.cookie !== 'dsh_session=native') return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    sockets.handleUpgrade(request, socket, head, client => {
      client.on('message', data => {
        const { streamId } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ streamId: Schema.String })))(String(data))
        client.send(JSON.stringify({ streamId, type: 'item', value: { type: 'snapshot', origin: request.headers.origin } }))
      })
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, sockets, seen, port: portOf(server) }
}

const storeRuntime = async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'multi-host-link-'))
  const paths = Layer.effect(
    MultiHostPaths,
    Effect.map(Path.Path, path => MultiHostPaths.make({ dshHome, path })),
  )
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(LinkStore.layer.pipe(Layer.provideMerge(paths)), FetchHttpClient.layer).pipe(Layer.provideMerge(NodeServices.layer)),
  )
  const store = await runtime.runPromise(Effect.service(LinkStore))
  return { dshHome, runtime, store }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Machine B: native listener, link store and link server; machine A: its own store holding the credential. */
const pairPair = async () => {
  const native = await startNative()
  const peer = await storeRuntime()
  const linkServer = createLinkServer({
    upstreamPort: native.port,
    cookieName: 'dsh_link_fixture',
    authenticate: token => peer.store.authenticate(token),
    redeem: input =>
      peer.runtime.runPromise(
        peer.store.redeem(input).pipe(
          Effect.map(redeemed => ({ ok: true as const, credential: redeemed.credential, runtimeId: peerRuntimeId, name: 'peer' })),
          Effect.catchTag('LinkPairRefused', error => Effect.succeed({ ok: false as const, status: 409, reason: error.reason, message: error.message })),
          Effect.orDie,
        ),
      ),
    nativeCookie: async () => 'dsh_session=native',
    nativeCookieRejected: () => undefined,
  })
  linkServer.server.listen(0, '127.0.0.1')
  await once(linkServer.server, 'listening')
  const url = `http://127.0.0.1:${portOf(linkServer.server)}`
  const pairing = await storeRuntime()
  cleanups.push(async () => {
    linkServer.closeAll()
    linkServer.server.close()
    native.sockets.close()
    native.server.closeAllConnections()
    native.server.close()
    await peer.runtime.dispose()
    await pairing.runtime.dispose()
    await rm(peer.dshHome, { recursive: true, force: true })
    await rm(pairing.dshHome, { recursive: true, force: true })
  })
  const redeem = (code: string) =>
    pairing.runtime.runPromise(Effect.result(redeemPairingCode({ url, code, name: 'laptop', runtimeId: pairingRuntimeId, allowPlainHttp: false })))
  const connect = async () => {
    const scope = await pairing.runtime.runPromise(Scope.make())
    cleanups.push(() => pairing.runtime.runPromise(Scope.close(scope, Exit.void)))
    return pairing.runtime.runPromise(Effect.result(Scope.provide(scope)(connectDirect({ url }))))
  }
  return { native, peer, pairing, linkServer, url, redeem, connect }
}

describe('linked machines', () => {
  test('a pairing code buys a credential that reaches the native runtime with its own cookie and authority', async () => {
    const { native, peer, pairing, url, redeem, connect } = await pairPair()
    const offer = await peer.runtime.runPromise(peer.store.offer)
    const redeemed = await redeem(offer.code.toLowerCase())
    if (redeemed._tag !== 'Success') throw new Error(`redeem failed: ${String(redeemed.failure)}`)
    expect(redeemed.success.runtimeId).toBe(peerRuntimeId)
    await pairing.runtime.runPromise(pairing.store.saveCredential({ url, credential: redeemed.success.credential }))

    const opened = await connect()
    if (opened._tag !== 'Success') throw new Error(`connect failed: ${String(opened.failure)}`)
    const value = await pairing.runtime.runPromise(opened.success.run({ namespace: 'session', method: 'list', args: {} }))
    expect(value).toEqual({ host: `127.0.0.1:${native.port}` })
    // The peer's link cookie never reaches the native listener.
    expect(native.seen.cookies).toEqual(['dsh_session=native'])

    const frames = await pairing.runtime.runPromise(Effect.scoped(opened.success.follow({ endpoint: 'session/follow', args: {}, timeout: '5 seconds' })))
    expect(frames).toEqual([{ type: 'snapshot', origin: `http://127.0.0.1:${native.port}` }])

    // Only a hash of the credential is stored, in a 0600 file.
    const peers = await peer.runtime.runPromise(peer.store.peers)
    expect(peers).toHaveLength(1)
    expect(JSON.stringify(peers)).not.toContain(redeemed.success.credential)
    expect((await stat(join(peer.dshHome, 'plugins', 'multi-host', 'links.json'))).mode & 0o777).toBe(0o600)
  })

  test('a code works once, and an unknown code is refused', async () => {
    const { peer, redeem } = await pairPair()
    const offer = await peer.runtime.runPromise(peer.store.offer)
    expect((await redeem(offer.code))._tag).toBe('Success')
    const again = await redeem(offer.code)
    expect(again._tag === 'Failure' && again.failure.reason).toBe('used')
    const unknown = await redeem('AAAA-BBBB-CCCC')
    expect(unknown._tag === 'Failure' && unknown.failure.reason).toBe('unknown')
  })

  test('unlinking a machine closes it out at once', async () => {
    const { peer, pairing, linkServer, url, redeem, connect } = await pairPair()
    const offer = await peer.runtime.runPromise(peer.store.offer)
    const redeemed = await redeem(offer.code)
    if (redeemed._tag !== 'Success') throw new Error('redeem failed')
    await pairing.runtime.runPromise(pairing.store.saveCredential({ url, credential: redeemed.success.credential }))
    const opened = await connect()
    if (opened._tag !== 'Success') throw new Error('connect failed')

    const [linked] = await peer.runtime.runPromise(peer.store.peers)
    if (linked === undefined) throw new Error('no peer')
    await peer.runtime.runPromise(peer.store.revoke(linked.id))
    linkServer.closeUnauthorised()

    const refused = await pairing.runtime.runPromise(Effect.flip(opened.success.run({ namespace: 'session', method: 'list', args: {} })))
    expect(refused._tag).toBe('AuthenticationExpired')
    const reconnect = await connect()
    expect(reconnect._tag === 'Failure' && reconnect.failure._tag).toBe('AuthenticationFailed')
  })

  test('a machine with no stored credential gets a recovery path, not a hang', async () => {
    const { connect } = await pairPair()
    const opened = await connect()
    expect(opened._tag === 'Failure' && opened.failure._tag).toBe('LinkCredentialMissing')
  })

  test('plain HTTP outside Tailscale and loopback needs explicit consent', async () => {
    expect(linkTransport('https://box.example.ts.net')).toBe('tls')
    expect(linkTransport('http://100.101.2.3:3459')).toBe('tailnet')
    expect(linkTransport('http://box.tailnet-name.ts.net:3459')).toBe('tailnet')
    expect(linkTransport('http://127.0.0.1:3459')).toBe('loopback')
    expect(linkTransport('http://192.168.1.10:3459')).toBe('plain')
    const runtime = ManagedRuntime.make(FetchHttpClient.layer)
    const refused = await runtime.runPromise(
      Effect.flip(
        redeemPairingCode({ url: 'http://192.168.1.10:3459', code: 'AAAA-BBBB-CCCC', name: 'x', runtimeId: pairingRuntimeId, allowPlainHttp: false }),
      ),
    )
    expect(refused.reason).toBe('insecure-url')
    await runtime.dispose()
  })
})

describe('link telemetry', () => {
  test('records one pairing span with the transport kind, never the code or the credential', async () => {
    const { peer, url } = await pairPair()
    const offer = await peer.runtime.runPromise(peer.store.offer)
    using recorder = recordSpans()
    const redeemed = await Effect.runPromise(
      redeemPairingCode({ url, code: offer.code, name: 'laptop', runtimeId: pairingRuntimeId, allowPlainHttp: false }).pipe(
        Effect.provide(Layer.mergeAll(FetchHttpClient.layer, tracerLayer)),
      ),
    )
    const span = recorder.span('multi-host link pair')
    expect(span.attributes).toMatchObject({ 'multi_host.link.transport': 'loopback' })
    expect(JSON.stringify(span.attributes)).not.toContain(offer.code)
    expect(JSON.stringify(span.attributes)).not.toContain(redeemed.credential)
  })
})

describe('pairing links and listen plans', () => {
  test('one pasted link carries the origin and the code', () => {
    expect(LinkPlan.parsePairingLink({ link: 'http://100.101.2.3:3459/link#code=ABCD-EFGH-JKMN' })).toEqual({
      url: 'http://100.101.2.3:3459',
      code: 'ABCD-EFGH-JKMN',
    })
    expect(LinkPlan.parsePairingLink({ link: 'http://100.101.2.3:3459', code: 'ABCD-EFGH-JKMN' })).toEqual({
      url: 'http://100.101.2.3:3459',
      code: 'ABCD-EFGH-JKMN',
    })
    expect(LinkPlan.parsePairingLink({ link: 'http://100.101.2.3:3459' })).toBeUndefined()
    expect(LinkPlan.parsePairingLink({ link: 'not a url' })).toBeUndefined()
  })

  test('the tailscale mode binds the tailnet address only, and has none without Tailscale', () => {
    const settings = { enabled: true, listen: 'tailscale' as const, port: 3459 }
    expect(LinkPlan.listen({ settings, addresses: { tailnet: ['100.101.2.3'], other: ['192.168.1.4'] } })).toEqual({
      bind: '100.101.2.3',
      urls: ['http://100.101.2.3:3459'],
    })
    expect(LinkPlan.listen({ settings, addresses: { tailnet: [], other: ['192.168.1.4'] } })).toBeUndefined()
    expect(
      LinkPlan.listen({ settings: { ...settings, listen: 'loopback', advertiseUrl: 'https://box.tailnet.ts.net' }, addresses: { tailnet: [], other: [] } }),
    ).toEqual({ bind: '127.0.0.1', urls: ['https://box.tailnet.ts.net', 'http://127.0.0.1:3459'] })
  })
})
