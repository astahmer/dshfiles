import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPairingCore, claimCommitment, newClaimSecret } from './index.mjs'

const fixture = async run => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-test-'))
  try {
    await run(join(directory, 'state.json'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** One full claim, approval and redemption for tests that only need a device. */
const enroll = async ({ core, name = 'Phone' }) => {
  const enrollment = core.beginEnrollment({ name })
  const claimSecret = newClaimSecret()
  const commitment = claimCommitment(claimSecret)
  assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment }), true)
  assert.equal(core.approveEnrollment({ id: enrollment.id, commitment }), true)
  const device = await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret })
  assert.ok(device)
  return { enrollment, claimSecret, commitment, device }
}

test('approval, one-time redemption, persisted hashed credential and revocation', async () =>
  fixture(async path => {
    const core = await createPairingCore({ path })
    const enrollment = core.beginEnrollment({ name: 'Phone' })
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    assert.equal(await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret }), null)
    assert.equal(JSON.stringify(core.pendingEnrollments()).includes(enrollment.secret), false)
    assert.equal(core.approveEnrollment({ id: enrollment.id, commitment }), false)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: 'wrong', commitment }), false)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment: 'not-a-digest' }), false)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment }), true)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment }), true)
    assert.equal(core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment: claimCommitment(newClaimSecret()) }), false)
    assert.equal(JSON.stringify(core.pendingEnrollments()).includes(claimSecret), false)
    assert.equal(JSON.stringify(core.pendingEnrollments()).includes(commitment), true)
    assert.equal(core.approveEnrollment({ id: enrollment.id, commitment: claimCommitment(newClaimSecret()) }), false)
    assert.equal(core.approveEnrollment({ id: enrollment.id, commitment }), true)
    assert.equal(await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret: newClaimSecret() }), null)
    const attempts = await Promise.all([
      core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret }),
      core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret }),
    ])
    const result = attempts.find(Boolean)
    assert.ok(result)
    assert.equal(attempts.filter(Boolean).length, 1)
    const stored = await readFile(path, 'utf8')
    assert.equal(stored.includes(result.credential), false)
    assert.equal(stored.includes(enrollment.secret), false)
    assert.equal(stored.includes(claimSecret), false)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    const restarted = await createPairingCore({ path })
    assert.equal(await restarted.openSession({ deviceId: result.deviceId, credential: 'wrong' }), null)
    const session = await restarted.openSession(result)
    assert.ok(session)
    assert.equal(restarted.authenticateSession(session).deviceId, result.deviceId)
    assert.equal(await restarted.revokeDevice({ deviceId: result.deviceId }), true)
    assert.equal(restarted.authenticateSession(session), null)
    assert.equal(await restarted.openSession(result), null)
    assert.deepEqual((await createPairingCore({ path })).listDevices(), [])
  }))

test('capacity is bounded and expired entries release space', async () =>
  fixture(async path => {
    let time = 1000
    const core = await createPairingCore({ path, now: () => time, enrollmentTtlMs: 10, sessionTtlMs: 10, maxEnrollments: 1, maxSessions: 1 })
    const first = core.beginEnrollment({ name: 'Phone' })
    assert.throws(() => core.beginEnrollment({ name: 'Other' }), /capacity/)
    time += 10
    const enrollment = core.beginEnrollment({ name: 'Phone' })
    assert.notEqual(first.id, enrollment.id)
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    core.claimEnrollment({ id: enrollment.id, secret: enrollment.secret, commitment })
    core.approveEnrollment({ id: enrollment.id, commitment })
    const device = await core.redeemEnrollment({ id: enrollment.id, secret: enrollment.secret, claimSecret })
    const session = await core.openSession(device)
    await assert.rejects(core.openSession(device), /capacity/)
    assert.equal(core.closeSession(session), true)
    await core.openSession(device)
    time += 10
    assert.ok(await core.openSession(device))
    for (const option of [{ maxEnrollments: 0 }, { maxSessions: Infinity }]) await assert.rejects(createPairingCore({ path, ...option }), /capacity/)
  }))

test('credential expiry survives restart and caps sessions', async () =>
  fixture(async path => {
    let time = 1000
    const now = () => time
    const core = await createPairingCore({ path, now, credentialTtlMs: 100, sessionTtlMs: 1000 })
    const { enrollment, device } = await enroll({ core })
    assert.equal(core.listDevices()[0].expiresAt, 1100)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 2)
    time = 1099
    const restarted = await createPairingCore({ path, now, credentialTtlMs: 10000, sessionTtlMs: 1000 })
    const session = await restarted.openSession(device)
    assert.equal(session.expiresAt, 1100)
    assert.ok(restarted.authenticateSession(session))
    time = 1100
    assert.equal(restarted.authenticateSession(session), null)
    assert.equal(await restarted.openSession(device), null)
    assert.equal(await (await createPairingCore({ path, now })).openSession(device), null)
    assert.equal(await restarted.redeemEnrollment(enrollment), null)
  }))

test('default credential lifetime and version rejection', async () =>
  fixture(async path => {
    let time = 1000
    const core = await createPairingCore({ path, now: () => time })
    const { device } = await enroll({ core })
    const expiry = 1000 + 365 * 24 * 3_600_000
    assert.equal(core.listDevices()[0].expiresAt, expiry)
    time = expiry
    assert.equal(await core.openSession(device), null)
    for (const credentialTtlMs of [0, -1, Infinity, 1.5]) await assert.rejects(createPairingCore({ path, credentialTtlMs }), /lifetime/)
    const state = JSON.parse(await readFile(path, 'utf8'))
    for (const version of [1, 3]) {
      await writeFile(path, JSON.stringify({ ...state, version }))
      await assert.rejects(createPairingCore({ path }), /Invalid pairing state/)
    }
    await writeFile(path, JSON.stringify({ ...state, devices: [{ ...state.devices[0], expiresAt: null }] }))
    await assert.rejects(createPairingCore({ path }), /Invalid pairing state/)
  }))

test('directory sync failure revokes in memory and fails closed', async () =>
  fixture(async path => {
    let calls = 0
    const core = await createPairingCore({
      path,
      syncParentDirectory: async () => {
        if (++calls === 2) throw new Error('sync failed')
      },
    })
    const { device } = await enroll({ core })
    const session = await core.openSession(device)
    await assert.rejects(core.revokeDevice(device), /sync failed/)
    assert.equal(core.authenticateSession(session), null)
    await assert.rejects(core.openSession(device), /storage unavailable/)
    assert.throws(() => core.beginEnrollment({ name: 'Other' }), /storage unavailable/)
    assert.deepEqual((await createPairingCore({ path })).listDevices(), [])
  }))

test('expiration, close, restart, and malformed persistent state', async () =>
  fixture(async path => {
    let time = 1000
    const core = await createPairingCore({ path, now: () => time, enrollmentTtlMs: 10, sessionTtlMs: 10 })
    const expired = core.beginEnrollment({ name: 'Phone' })
    const expiredClaimSecret = newClaimSecret()
    const expiredCommitment = claimCommitment(expiredClaimSecret)
    core.claimEnrollment({ id: expired.id, secret: expired.secret, commitment: expiredCommitment })
    core.approveEnrollment({ id: expired.id, commitment: expiredCommitment })
    time += 10
    assert.equal(await core.redeemEnrollment({ id: expired.id, secret: expired.secret, claimSecret: expiredClaimSecret }), null)
    const { device } = await enroll({ core })
    const first = await core.openSession(device)
    assert.equal(core.closeSession(first), true)
    assert.equal(core.authenticateSession(first), null)
    const second = await core.openSession(device)
    assert.equal((await createPairingCore({ path })).authenticateSession(second), null)
    time += 10
    assert.equal(core.authenticateSession(second), null)
    await writeFile(path, '{invalid')
    await assert.rejects(createPairingCore({ path }))
  }))
