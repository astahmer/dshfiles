import { strict as assert } from 'node:assert'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import { claimCommitment, createPairingCore, newClaimSecret } from './index.mjs'
import { createTestProxy } from './proxy.mjs'

/** Complete one bound claim so tests can exercise a real device credential. */
const enrollDevice = async ({ core, name }) => {
  const enrollment = core.beginEnrollment({ name })
  const claimSecret = newClaimSecret()
  const commitment = claimCommitment(claimSecret)
  if (!core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment })) throw new Error('claim rejected')
  if (!core.approveEnrollment({ id: enrollment.id, commitment })) throw new Error('approval rejected')
  const device = await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret })
  if (!device) throw new Error('redemption rejected')
  return device
}

const listen = async server => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const request = ({ port, cookie, origin, host, method = 'GET', path = '/', headers = {} }) =>
  new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: { ...headers, host: host || `127.0.0.1:${port}`, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      },
      response => {
        let body = ''
        response.on('data', chunk => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })

test('proxy rejects non-loopback and ambiguous upstream configuration', () => {
  const config = { core: {}, origin: 'http://127.0.0.1:1234', upstreamCookie: 'native=fixture' }
  for (const upstream of [
    'http://localhost:1234',
    'http://127.0.0.2:1234',
    'http://example.com',
    'https://127.0.0.1',
    'http://127.0.0.1/path',
    'http://127.0.0.1/?token=secret',
  ]) {
    assert.throws(() => createTestProxy({ ...config, upstream }), /Invalid proxy configuration/)
  }
  assert.throws(() => createTestProxy({ ...config, upstream: 'http://127.0.0.1', websocketPath: '//evil' }), /Invalid proxy configuration/)
  for (const trustedTlsTermination of [undefined, false, 'true']) {
    assert.throws(
      () => createTestProxy({ ...config, origin: 'https://phone.example', upstream: 'http://127.0.0.1', trustedTlsTermination }),
      /Invalid proxy configuration/,
    )
  }
  const proxy = createTestProxy({ ...config, origin: 'https://phone.example', upstream: 'http://127.0.0.1', trustedTlsTermination: true })
  proxy.close()
})

test('revocation fences real sockets while persistence is pending and on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-fence-'))
  let blockSync = false
  let enteredSync
  let releaseSync
  const entered = new Promise(resolve => {
    enteredSync = resolve
  })
  const release = new Promise(resolve => {
    releaseSync = resolve
  })
  const core = await createPairingCore({
    path: join(directory, 'state.json'),
    syncParentDirectory: async () => {
      if (!blockSync) return
      enteredSync()
      await release
      throw new Error('simulated persist failure')
    },
  })
  const enroll = async name => {
    const device = await enrollDevice({ core, name })
    const session = await core.openSession(device)
    return { device, session }
  }
  const first = await enroll('first')
  const second = await enroll('second')
  const upstream = http.createServer()
  upstream.on('upgrade', (incoming, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('end', () => socket.destroy())
  })
  const upstreamPort = await listen(upstream)
  const reservation = net.createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const proxy = createTestProxy({ core, upstream: `http://127.0.0.1:${upstreamPort}`, upstreamCookie: 'native=server-only', origin })
  await new Promise(resolve => proxy.listen(port, '127.0.0.1', resolve))
  const connect = async session => {
    const socket = net.connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(
      `GET /api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nCookie: pairing_session=${session.secret}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    )
    const [handshake] = await once(socket, 'data')
    assert.match(handshake.toString(), /101 Switching Protocols/)
    return socket
  }
  try {
    const firstSocket = await connect(first.session)
    const secondSocket = await connect(second.session)
    const firstClosed = once(firstSocket, 'close')
    const secondClosed = once(secondSocket, 'close')
    blockSync = true
    const revocation = core.revokeDevice({ deviceId: first.device.deviceId })
    const rejected = assert.rejects(revocation, /simulated persist failure/)
    await entered
    await firstClosed
    assert.equal((await request({ port, cookie: `pairing_session=${first.session.secret}`, origin })).status, 403)
    assert.equal(secondSocket.destroyed, false)
    releaseSync()
    await rejected
    await secondClosed
    assert.equal((await request({ port, cookie: `pairing_session=${second.session.secret}`, origin })).status, 403)
  } finally {
    releaseSync()
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('real HTTP and upgrade sockets require pairing and close on revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-proxy-'))
  const core = await createPairingCore({ path: join(directory, 'state.json') })
  const device = await enrollDevice({ core, name: 'phone' })
  const session = await core.openSession(device)
  let seenCookie
  let seenOrigin
  let seenHost
  let seenHeaders
  let seenPath
  let hits = 0
  let seenBody = ''
  const upstream = http.createServer((incoming, response) => {
    hits++
    seenHeaders = incoming.headers
    seenPath = incoming.url
    seenCookie = incoming.headers.cookie
    seenOrigin = incoming.headers.origin
    seenHost = incoming.headers.host
    response.setHeader('set-cookie', 'native=should-not-leak')
    incoming.on('data', chunk => {
      seenBody += chunk
    })
    incoming.on('end', () => response.end('ok'))
  })
  upstream.on('upgrade', (incoming, socket) => {
    hits++
    seenHeaders = incoming.headers
    seenCookie = incoming.headers.cookie
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: native=should-not-leak\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
    socket.on('end', () => socket.destroy())
  })
  const upstreamPort = await listen(upstream)
  const reservation = net.createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const proxy = createTestProxy({ core, upstream: `http://127.0.0.1:${upstreamPort}`, upstreamCookie: 'native=server-only', origin })
  await new Promise(resolve => proxy.listen(port, '127.0.0.1', resolve))
  try {
    const cookie = `pairing_session=${session.secret}; attacker=ignored`
    const smuggled = net.connect(port, '127.0.0.1')
    await once(smuggled, 'connect')
    smuggled.write(
      `POST / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
    )
    const [parserRejection] = await once(smuggled, 'data')
    assert.match(parserRejection.toString(), /400 Bad Request/)
    assert.equal(hits, 0)
    smuggled.destroy()
    assert.equal((await request({ port })).status, 403)
    assert.equal((await request({ port, cookie, host: 'evil.test' })).status, 403)
    assert.equal((await request({ port, cookie, origin: 'http://evil.test' })).status, 403)
    assert.equal((await request({ port, cookie, method: 'POST' })).status, 403)
    assert.equal((await request({ port, cookie, method: 'POST', origin: 'null' })).status, 403)
    assert.equal((await request({ port, cookie: `${cookie}; pairing_session=${session.secret}` })).status, 403)
    for (const path of ['http://evil.test/path', '//evil.test/path', '/\\evil', '/path#fragment', '/?token=secret', '/?%54oken=secret']) {
      const before = hits
      assert.equal((await request({ port, cookie, origin, path })).status, 403)
      assert.equal(hits, before)
    }
    const response = await request({
      port,
      cookie,
      origin,
      path: '/valid?x=1',
      headers: {
        authorization: 'Bearer fake-token',
        forwarded: 'for=evil',
        'x-forwarded-port': '1',
        'x-real-ip': 'evil',
        connection: 'keep-alive, x-remove',
        'x-remove': 'spoof',
      },
    })
    assert.equal(response.body, 'ok')
    assert.equal(seenPath, '/valid?x=1')
    for (const name of ['authorization', 'forwarded', 'x-forwarded-port', 'x-real-ip', 'x-remove']) assert.equal(seenHeaders[name], undefined)
    assert.equal(JSON.stringify(seenHeaders).includes(session.secret), false)
    await new Promise((resolve, reject) => {
      const outgoing = http.request(
        { hostname: '127.0.0.1', port, method: 'POST', headers: { host: `127.0.0.1:${port}`, origin, cookie, 'transfer-encoding': 'chunked' } },
        incoming => {
          incoming.resume()
          incoming.on('end', resolve)
        },
      )
      outgoing.on('error', reject)
      outgoing.write('streamed ')
      outgoing.end('body')
    })
    assert.equal(seenBody, 'streamed body')
    assert.equal(JSON.stringify(response).includes('server-only'), false)
    for (const path of ['/other', '//evil.test/path', 'http://evil.test/', '/api/remote.mux?token=secret']) {
      const rejectedSocket = net.connect(port, '127.0.0.1')
      await once(rejectedSocket, 'connect')
      const before = hits
      rejectedSocket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      )
      const [rejection] = await once(rejectedSocket, 'data')
      assert.match(rejection.toString(), /403 Forbidden/)
      assert.equal(rejection.toString().includes(session.secret), false)
      assert.equal(hits, before)
      rejectedSocket.destroy()
    }
    assert.equal(response.headers['set-cookie'], undefined)
    assert.equal(seenCookie, 'native=server-only')
    assert.equal(seenOrigin, `http://127.0.0.1:${upstreamPort}`)
    assert.equal(seenHost, `127.0.0.1:${upstreamPort}`)
    const socket = net.connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(
      `GET /api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nConnection: Upgrade, X-Remove\r\nUpgrade: websocket\r\nX-Remove: spoof\r\nX-Forwarded-Prefix: spoof\r\n\r\n`,
    )
    const [handshake] = await once(socket, 'data')
    assert.match(handshake.toString(), /101 Switching Protocols/)
    assert.equal(seenHeaders['x-remove'], undefined)
    assert.equal(seenHeaders['x-forwarded-prefix'], undefined)
    assert.equal(seenHeaders.connection, 'Upgrade')
    assert.equal(seenHeaders.upgrade, 'websocket')
    assert.equal(JSON.stringify(seenHeaders).includes(session.secret), false)
    assert.equal(handshake.toString().includes('server-only'), false)
    assert.doesNotMatch(handshake.toString(), /Set-Cookie/i)
    assert.equal(seenCookie, 'native=server-only')
    const closed = once(socket, 'close')
    await core.revokeDevice({ deviceId: device.deviceId })
    await closed
    assert.equal((await request({ port, cookie, origin })).status, 403)
  } finally {
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
