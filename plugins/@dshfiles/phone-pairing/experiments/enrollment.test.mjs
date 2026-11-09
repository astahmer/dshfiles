import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimCommitment, createPairingCore, newClaimSecret } from './index.mjs'
import { createEnrollmentFixture } from './enrollment.mjs'

const origin = 'https://phone.example'
const fixture = async run => {
  const directory = await mkdtemp(join(tmpdir(), 'enrollment-test-'))
  try {
    const core = await createPairingCore({ path: join(directory, 'state.json') })
    await run({ core, ...createEnrollmentFixture({ core, origin }) })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
const request = (input, options = {}) =>
  new Request(options.url ?? `${origin}/pair/redeem`, {
    method: options.method ?? 'POST',
    headers: { origin: options.origin ?? origin, 'content-type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify(input),
  })
const fragment = enrollment => Object.fromEntries(new URLSearchParams(new URL(enrollment.url).hash.slice(1)))
const claimBody = ({ id, secret, commitment }) => request({ id, secret, commitment }, { url: `${origin}/pair/claim` })
const redeemBody = ({ id, secret, claimSecret }) => request({ id, secret, claimSecret })

test('claim binds a phone secret; approval is exact and the QR bearer cannot redeem', async () =>
  fixture(async ({ desktop, handle }) => {
    const enrollment = desktop.begin({ name: 'Phone' })
    const { id, secret } = fragment(enrollment)
    assert.equal(new URL(enrollment.url).search, '')
    assert.deepEqual(desktop.pending(), [])
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    assert.equal((await handle(claimBody({ id, secret, commitment }))).status, 204)
    assert.equal((await handle(claimBody({ id, secret, commitment: claimCommitment(newClaimSecret()) }))).status, 403)
    const pending = desktop.pending()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].commitment, commitment)
    assert.equal(JSON.stringify(pending).includes(claimSecret), false)
    assert.equal(desktop.approve({ id, commitment: claimCommitment(newClaimSecret()) }), false)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret }))).status, 403)
    assert.equal(desktop.approve({ id, commitment }), true)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret: newClaimSecret() }))).status, 403)
    assert.equal((await handle(request({ id, secret }))).status, 400)
    const results = await Promise.all([handle(redeemBody({ id, secret, claimSecret })), handle(redeemBody({ id, secret, claimSecret }))])
    assert.deepEqual(results.map(result => result.status).sort(), [204, 403])
    const cookie = results.find(result => result.status === 204).headers.get('set-cookie')
    assert.match(cookie, /^__Host-pairing_device=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict$/)
    assert.equal(cookie.includes(secret), false)
    assert.equal(cookie.includes(claimSecret), false)
    assert.equal(cookie.includes(commitment), false)
  }))

test('a copied QR secret cannot redeem another phone claim', async () =>
  fixture(async ({ desktop, handle, core }) => {
    const enrollment = desktop.begin({ name: 'Phone' })
    const { id, secret } = fragment(enrollment)
    const phoneClaimSecret = newClaimSecret()
    const attackerClaimSecret = newClaimSecret()
    desktop.approve({ id, commitment: claimCommitment(attackerClaimSecret) })
    assert.equal((await handle(claimBody({ id, secret, commitment: claimCommitment(phoneClaimSecret) }))).status, 204)
    assert.equal(desktop.approve({ id, commitment: claimCommitment(attackerClaimSecret) }), false)
    assert.equal(desktop.approve({ id, commitment: claimCommitment(phoneClaimSecret) }), true)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret: attackerClaimSecret }))).status, 403)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret: phoneClaimSecret }))).status, 204)
    assert.equal(core.listDevices().length, 1)
  }))

test('rejects cross-origin, insecure, malformed and oversized requests without consuming enrollment', async () =>
  fixture(async ({ desktop, handle }) => {
    assert.throws(() => createEnrollmentFixture({ core: {}, origin: 'http://phone.example' }))
    const enrollment = desktop.begin({ name: 'Phone' })
    const { id, secret } = fragment(enrollment)
    const claimSecret = newClaimSecret()
    const commitment = claimCommitment(claimSecret)
    assert.equal((await handle(claimBody({ id, secret, commitment }))).status, 204)
    desktop.approve({ id, commitment })
    for (const options of [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { url: 'http://phone.example/pair/redeem' },
      { url: `${origin}/pair/redeem?secret=bad` },
    ])
      assert.equal((await handle(request({ id, secret, claimSecret }, options))).status, 403)
    const missingOrigin = new Request(`${origin}/pair/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, secret, claimSecret }),
    })
    assert.equal((await handle(missingOrigin)).status, 403)
    assert.equal((await handle(request({ id, secret, claimSecret }, { headers: { 'content-type': 'text/plain' } }))).status, 415)
    assert.equal((await handle(request({ id, secret, claimSecret }, { body: '{' }))).status, 400)
    assert.equal((await handle(request({ id, secret, claimSecret }, { body: 'x'.repeat(1025) }))).status, 413)
    assert.equal((await handle(request({ ...{ id, secret, claimSecret }, approve: true }))).status, 400)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret: newClaimSecret() }))).status, 403)
    assert.equal((await handle(redeemBody({ id, secret, claimSecret }))).status, 204)
  }))
