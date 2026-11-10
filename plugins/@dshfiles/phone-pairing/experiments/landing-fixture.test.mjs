import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { handleLandingFixture } from './landing-fixture.mjs'

const page = () => handleLandingFixture(new Request('https://fixture.test/pair'))
const script = async () => (await handleLandingFixture(new Request('https://fixture.test/pair/landing.js'))).text()
const flush = async () => {
  for (let index = 0; index < 10; index += 1) await new Promise(resolve => setImmediate(resolve))
}

const harness = async ({ hash = '#id=fixture-id&secret=fixture-secret', responses = [204, 204, 204] } = {}) => {
  const calls = []
  const status = { textContent: '' }
  const button = {
    hidden: true,
    disabled: false,
    addEventListener: (_event, callback) => {
      button.click = callback
    },
  }
  const location = { hash, pathname: '/pair', search: '', assign: path => calls.push(['navigate', path]) }
  const history = {
    replaceState: (_state, _title, path) => {
      calls.push(['replace', path])
      location.hash = ''
    },
  }
  const fetch = async (path, options) => {
    calls.push(['post', path, options])
    return { ok: responses.shift() === 204 }
  }
  runInNewContext(await script(), {
    location,
    history,
    URLSearchParams,
    fetch,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa,
    document: { querySelector: selector => (selector === '#status' ? status : button) },
  })
  await flush()
  return { calls, status, button, location }
}

test('landing fixture provides restrictive headers and no external resources', async () => {
  const response = page()
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.doesNotMatch(await response.text(), /https?:\/\//)
  assert.equal(handleLandingFixture(new Request('https://fixture.test/pair?secret=x')).status, 404)
})

test('fragment removed before claim; redemption and session require user action', async () => {
  const result = await harness()
  assert.deepEqual(
    result.calls.map(call => call.slice(0, 2)),
    [
      ['replace', '/pair'],
      ['post', '/pair/claim'],
    ],
  )
  assert.equal(result.location.hash, '')
  assert.match(result.status.textContent, /Waiting for approval/)
  const claim = result.calls.find(call => call[1] === '/pair/claim')
  const claimBody = JSON.parse(claim[2].body)
  assert.deepEqual(Object.keys(claimBody).sort(), ['commitment', 'id', 'secret'])
  assert.match(claimBody.commitment, /^[a-f0-9]{64}$/)
  assert.equal(result.button.hidden, false)
  await result.button.click()
  const { createHash } = await import('node:crypto')
  const redeemCall = result.calls.find(call => call[1] === '/pair/redeem')
  const redeemBody = JSON.parse(redeemCall[2].body)
  assert.equal(redeemBody.claimSecret.length, 43)
  assert.equal(createHash('sha256').update(`dsh-pairing-claim-v1:${redeemBody.claimSecret}`).digest('hex'), claimBody.commitment)
  assert.equal(redeemBody.secret, 'fixture-secret')
  assert.deepEqual(
    result.calls.map(call => call.slice(0, 2)),
    [
      ['replace', '/pair'],
      ['post', '/pair/claim'],
      ['post', '/pair/redeem'],
      ['post', '/pair/session'],
      ['navigate', '/'],
    ],
  )
  assert.equal(result.calls[3][2].body, undefined)
})

test('invalid fragment and failed claim or redemption never open session', async () => {
  const invalid = await harness({ hash: '#id=x&secret=y&secret=z' })
  assert.deepEqual(invalid.calls, [['replace', '/pair']])
  const rejected = await harness({ responses: [403] })
  assert.equal(rejected.button.hidden, true)
  const unapproved = await harness({ responses: [204, 403] })
  await unapproved.button.click()
  assert.equal(
    unapproved.calls.some(call => call[1] === '/pair/session'),
    false,
  )
  assert.match(unapproved.status.textContent, /Start again/)
})
