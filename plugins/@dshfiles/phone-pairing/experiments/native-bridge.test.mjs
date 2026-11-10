import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { claimCommitment, createPairingCore, newClaimSecret } from './index.mjs'
import { createTestProxy } from './proxy.mjs'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..')
const cli = join(root, 'tooling/dshx/packages/dshx/dist/cli/bin.js')
const enabled = process.env.PAIRING_NATIVE_TEST === '1'

const runScratch = async (args, stateDir) => {
  try {
    await execute(process.execPath, [cli, 'dev', ...args, '--state-dir', stateDir, '--json'], {
      cwd: root,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    const output = String(error.stderr || error.stdout || '').replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
    throw new Error(`Scratch ${args[0]} failed: ${output.slice(0, 1500)}`)
  }
}

const sendFrame = (socket, value) => {
  const payload = Buffer.from(JSON.stringify(value))
  assert.ok(payload.length < 65536)
  const mask = randomBytes(4)
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 255])
  const encoded = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
  socket.write(Buffer.concat([header, mask, encoded]))
}

const receiveFrame = async socket => {
  let buffer = Buffer.alloc(0)
  for await (const chunk of socket.iterator({ destroyOnReturn: false })) {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length < 2) continue
    let length = buffer[1] & 127
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) continue
      length = buffer.readUInt16BE(2)
      offset = 4
    }
    assert.notEqual(length, 127)
    if (buffer.length < offset + length) continue
    assert.equal(buffer[0] & 15, 1)
    return JSON.parse(buffer.subarray(offset, offset + length).toString())
  }
  throw new Error('Native WebSocket closed before a response')
}

test('scratch native HTTP and WebSocket bridge', { skip: !enabled, timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phone-native-test-'))
  const stateDir = join(directory, 'scratch')
  let proxy
  let socket
  try {
    await runScratch(
      ['up', '--name', `phone-native-${randomBytes(6).toString('hex')}`, '--plugin', '@dshfiles/loopback-access', '--timeout', '60000'],
      stateDir,
    )
    const state = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8'))
    const launch = new URL(state.launchUrl)
    assert.equal(launch.hostname, '127.0.0.1')
    assert.equal(launch.origin, state.origin)
    const bootstrap = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    assert.equal(bootstrap.status, 303)
    const upstreamCookie = bootstrap.headers.get('set-cookie')?.split(';')[0]
    assert.ok(upstreamCookie)
    const core = await createPairingCore({ path: join(directory, 'pairing.json') })
    const enrollment = core.beginEnrollment({ name: 'scratch phone' })
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment }), true)
    assert.equal(core.approveEnrollment({ id: enrollment.id, commitment }), true)
    const device = await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret })
    assert.ok(device)
    const session = await core.openSession(device)
    const reservation = net.createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const port = reservation.address().port
    await new Promise(resolveClose => reservation.close(resolveClose))
    const origin = `http://127.0.0.1:${port}`
    proxy = createTestProxy({ core, upstream: state.origin, upstreamCookie, origin })
    proxy.listen(port, '127.0.0.1')
    await once(proxy, 'listening')
    const unpaired = await fetch(origin, { signal: AbortSignal.timeout(10_000) })
    assert.equal(unpaired.status, 403)
    const cookie = `pairing_session=${session.secret}`
    const paired = await fetch(origin, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    assert.equal(paired.status, 200)
    assert.equal(paired.headers.has('set-cookie'), false)
    assert.ok((await paired.text()).includes('__DSH_BOOT__'))
    socket = net.connect(port, '127.0.0.1')
    socket.setTimeout(10_000, () => socket.destroy(new Error('WebSocket timed out')))
    await once(socket, 'connect')
    socket.write(
      `GET /api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`,
    )
    const [handshake] = await once(socket, 'data')
    assert.match(handshake.toString(), /^HTTP\/1\.1 101 /)
    assert.doesNotMatch(handshake.toString(), /set-cookie/i)
    const streamId = randomUUID()
    sendFrame(socket, { type: 'open', streamId, endpoint: 'no-such-endpoint', payload: {} })
    const frame = await receiveFrame(socket)
    assert.equal(frame.streamId, streamId)
    assert.equal(frame.type, 'error')
    const closed = once(socket, 'close')
    await core.revokeDevice({ deviceId: device.deviceId })
    await closed
    assert.equal((await fetch(origin, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })).status, 403)
  } finally {
    socket?.destroy()
    if (proxy?.listening) {
      proxy.closeAllConnections()
      await new Promise(resolveClose => proxy.close(resolveClose))
    }
    try {
      if (
        await readFile(join(stateDir, 'state.json')).then(
          () => true,
          () => false,
        )
      )
        await runScratch(['down'], stateDir)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
