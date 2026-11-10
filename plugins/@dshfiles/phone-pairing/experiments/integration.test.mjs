import { strict as assert } from 'node:assert'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimCommitment, createPairingCore, newClaimSecret } from './index.mjs'
import { createPairingSessionAdapter } from './integration.mjs'
import { createTestProxy } from './proxy.mjs'

const origin = 'https://phone.example'
const request = (path, { cookie, host = 'phone.example', source = origin, body, method = 'POST' } = {}) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { host, ...(source === null ? {} : { origin: source }), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
const cookie = response => response.headers.get('set-cookie').split(';')[0]
const listen = async server => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const get = (port, session) =>
  new Promise((resolve, reject) => {
    const outgoing = http.get({ hostname: '127.0.0.1', port, headers: { host: 'phone.example', origin, cookie: session } }, response => {
      let text = ''
      response.on('data', chunk => {
        text += chunk
      })
      response.on('end', () => resolve({ status: response.statusCode, text }))
    })
    outgoing.on('error', reject)
  })

test('enrollment cookie opens proxy session across restart and revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-integration-'))
  const path = join(directory, 'state.json')
  let upstream
  let proxy
  try {
    let core = await createPairingCore({ path })
    assert.throws(() => createPairingSessionAdapter({ core, origin }), /TLS/)
    assert.throws(() => createPairingSessionAdapter({ core, origin: 'http://phone.example', trustedTlsTermination: true }), /TLS/)
    let adapter = createPairingSessionAdapter({ core, origin, trustedTlsTermination: true })
    const enrollment = adapter.desktop.begin({ name: 'phone' })
    const fragment = new URLSearchParams(new URL(enrollment.url).hash.slice(1))
    const proof = { id: fragment.get('id'), secret: fragment.get('secret') }
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    assert.equal((await adapter.handle(request('/pair/claim', { body: { ...proof, commitment } }))).status, 204)
    assert.equal(adapter.desktop.approve({ id: enrollment.id, commitment }), true)
    const redeemed = await adapter.handle(request('/pair/redeem', { body: { ...proof, claimSecret } }))
    assert.equal(redeemed.status, 204)
    const deviceCookie = cookie(redeemed)
    assert.match(redeemed.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/)
    assert.equal(await redeemed.text(), '')
    for (const options of [
      { cookie: deviceCookie, host: 'evil.example' },
      { cookie: deviceCookie, source: 'https://evil.example' },
      { cookie: deviceCookie, source: null },
      { cookie: `${deviceCookie}; ${deviceCookie}` },
      {},
    ])
      assert.equal((await adapter.handle(request('/pair/session', options))).status, 403)
    const emptyRequest = new Request(`${origin}/pair/session`, {
      method: 'POST',
      headers: { host: 'phone.example', origin, cookie: deviceCookie, 'content-length': '0' },
    })
    assert.equal((await adapter.handle(emptyRequest)).status, 204)
    for (const length of ['1', '00', '0, 0']) {
      const invalid = new Request(`${origin}/pair/session`, {
        method: 'POST',
        headers: { host: 'phone.example', origin, cookie: deviceCookie, 'content-length': length },
      })
      assert.equal((await adapter.handle(invalid)).status, 400)
    }
    for (const headers of [{ 'transfer-encoding': 'chunked' }, { 'transfer-encoding': 'chunked', 'content-length': '0' }]) {
      const invalid = new Request(`${origin}/pair/session`, { method: 'POST', headers: { host: 'phone.example', origin, cookie: deviceCookie, ...headers } })
      assert.equal((await adapter.handle(invalid)).status, 400)
    }
    assert.equal((await adapter.handle(request('/pair/session', { cookie: deviceCookie, body: { unexpected: true } }))).status, 400)
    const opened = await adapter.handle(request('/pair/session', { cookie: deviceCookie }))
    assert.equal(opened.status, 204)
    assert.equal(await opened.text(), '')
    const sessionCookie = cookie(opened)
    assert.match(opened.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/)
    upstream = http.createServer((incoming, response) => response.end(incoming.headers.cookie === 'native=fixture' ? 'ok' : 'bad'))
    const upstreamPort = await listen(upstream)
    proxy = createTestProxy({ core, upstream: `http://127.0.0.1:${upstreamPort}`, upstreamCookie: 'native=fixture', origin, trustedTlsTermination: true })
    const port = await listen(proxy)
    assert.deepEqual(await get(port, sessionCookie), { status: 200, text: 'ok' })
    await new Promise(resolve => proxy.close(resolve))
    proxy = undefined
    core = await createPairingCore({ path })
    adapter = createPairingSessionAdapter({ core, origin, trustedTlsTermination: true })
    assert.equal(core.authenticateSession({ secret: sessionCookie.split('=')[1] }), null)
    const reopened = await adapter.handle(request('/pair/session', { cookie: deviceCookie }))
    assert.equal(reopened.status, 204)
    const deviceId = core.listDevices()[0].id
    assert.equal(await core.revokeDevice({ deviceId }), true)
    assert.equal(core.authenticateSession({ secret: cookie(reopened).split('=')[1] }), null)
    assert.equal((await adapter.handle(request('/pair/session', { cookie: deviceCookie }))).status, 403)
    assert.equal(JSON.stringify(core.listDevices()).includes(deviceCookie.split('=')[1]), false)
  } finally {
    if (proxy) await new Promise(resolve => proxy.close(resolve))
    if (upstream) await new Promise(resolve => upstream.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
