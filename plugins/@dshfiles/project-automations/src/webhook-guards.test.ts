import { describe, expect, it } from 'vitest'
import { PromptTemplate } from './prompt-template.js'
import { SlidingWindowLimiter } from './rate-limit.js'
import { bodyDigestOf, isDeliveryId } from './webhook-replay-store.js'
import { REPLAY_WINDOW_SECONDS, ReplayGuard, WebhookSignature } from './webhook-signature.js'

const SECRET = 'whsec-test-value'
const body = Buffer.from('{"ref":"main"}')
const now = Date.parse('2027-01-01T12:00:00Z')
const timestamp = String(now / 1000)

describe('HMAC verification', () => {
  const verify = (input: { signature?: string; timestamp?: string; body?: Buffer; now?: number; guard?: ReplayGuard; secret?: string }) =>
    WebhookSignature.verify({
      secret: input.secret ?? SECRET,
      body: input.body ?? body,
      signature: input.signature,
      timestamp: input.timestamp,
      now: input.now ?? now,
      guard: input.guard ?? new ReplayGuard(),
    })
  const signature = WebhookSignature.sign({ secret: SECRET, timestamp, body })

  it('accepts a request signed with the secret over the timestamp and the raw body', () => {
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/u)
    expect(verify({ signature, timestamp })).toEqual({ ok: true })
    expect(verify({ signature: signature.toUpperCase().replace('SHA256=', 'sha256='), timestamp })).toEqual({ ok: true })
  })

  it('refuses a missing, malformed or wrong signature, a changed body and another secret', () => {
    expect(verify({ timestamp })).toEqual({ ok: false, reason: 'missing-signature' })
    expect(verify({ signature })).toEqual({ ok: false, reason: 'missing-signature' })
    expect(verify({ signature: 'sha1=abc', timestamp })).toEqual({ ok: false, reason: 'malformed-signature' })
    expect(verify({ signature, timestamp: 'yesterday' })).toEqual({ ok: false, reason: 'malformed-signature' })
    expect(verify({ signature: `sha256=${'0'.repeat(64)}`, timestamp })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verify({ signature, timestamp, body: Buffer.from('{"ref":"evil"}') })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verify({ signature, timestamp, secret: 'another-secret' })).toEqual({ ok: false, reason: 'bad-signature' })
    // The timestamp is signed too: moving it invalidates the signature before the window is even checked.
    expect(verify({ signature, timestamp: String(now / 1000 + 1) })).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuses a request signed outside the replay window, before or after now', () => {
    const window = REPLAY_WINDOW_SECONDS * 1000
    expect(verify({ signature, timestamp, now: now + window })).toEqual({ ok: true })
    expect(verify({ signature, timestamp, now: now + window + 1 })).toEqual({ ok: false, reason: 'stale-timestamp' })
    expect(verify({ signature, timestamp, now: now - window - 1 })).toEqual({ ok: false, reason: 'stale-timestamp' })
  })

  it('refuses the same signed request twice inside the window and forgets it once the window passed', () => {
    const guard = new ReplayGuard()
    expect(verify({ signature, timestamp, guard })).toEqual({ ok: true })
    expect(verify({ signature, timestamp, guard, now: now + 1_000 })).toEqual({ ok: false, reason: 'replayed' })
    // A forged signature is never remembered, so it cannot block the genuine one.
    const fresh = new ReplayGuard()
    expect(verify({ signature: `sha256=${'1'.repeat(64)}`, timestamp, guard: fresh })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(fresh.size).toBe(0)
    expect(guard.claim('other', now + 10, now + REPLAY_WINDOW_SECONDS * 1000 + 1)).toBe(true)
    expect(guard.size).toBe(1)
  })
})

describe('rate limit', () => {
  it('allows the limit per sliding window and says when to retry', () => {
    const limiter = new SlidingWindowLimiter(60_000)
    expect(limiter.take('a', 2, 0)).toEqual({ allowed: true })
    expect(limiter.take('a', 2, 10_000)).toEqual({ allowed: true })
    expect(limiter.take('a', 2, 20_000)).toEqual({ allowed: false, retryAfterMs: 40_000 })
    // Another key has its own window.
    expect(limiter.take('b', 2, 20_000)).toEqual({ allowed: true })
    // Once the first hit leaves the window there is room again; refused calls were not counted.
    expect(limiter.take('a', 2, 60_001)).toEqual({ allowed: true })
    expect(limiter.take('a', 2, 60_002)).toEqual({ allowed: false, retryAfterMs: 9_998 })
  })
})

describe('prompt template', () => {
  const request = {
    body: {
      pull_request: { title: 'Fix login\u0000\u001b[31m', number: 42, labels: [{ name: 'bug' }] },
      note: '{{headers.authorization}}',
      big: 'x'.repeat(5_000),
    },
    headers: { 'x-github-event': 'pull_request', authorization: 'Bearer secret' },
  }

  it('fills body paths and named headers once, sanitized and clipped', () => {
    const filled = PromptTemplate.fill(
      'Review PR #{{body.pull_request.number}} "{{ body.pull_request.title }}" ({{headers.x-github-event}}), label {{body.pull_request.labels.0.name}}, note {{body.note}}, missing [{{body.nope.deeper}}]',
      request,
    )
    expect(filled).toBe('Review PR #42 "Fix login[31m" (pull_request), label bug, note {{headers.authorization}}, missing []')
    expect(PromptTemplate.fill('{{body.big}}', request)).toHaveLength(2_000)
    expect(PromptTemplate.fill('{{body.pull_request.labels}}', request)).toBe('[{"name":"bug"}]')
  })

  it('never reads a prototype property', () => {
    expect(PromptTemplate.fill('[{{body.constructor}}][{{body.__proto__}}][{{body.note.length}}]', request)).toBe('[][][]')
  })

  it('refuses credential headers, unknown roots and over-deep paths at save time', () => {
    expect(PromptTemplate.check('{{headers.authorization}}')).toMatchObject({ ok: false })
    expect(PromptTemplate.check('{{headers.x-api-token}}')).toMatchObject({ ok: false })
    expect(PromptTemplate.check('{{process.env.HOME}}')).toMatchObject({ ok: false })
    expect(PromptTemplate.check('{{body.a.b.c.d.e.f.g.h.i}}')).toMatchObject({ ok: false })
    expect(PromptTemplate.check('Plain text and {{body.a.b}} {{headers.x-github-event}}')).toEqual({ ok: true })
  })

  it('parses a JSON body and keeps any other body as sanitized text', () => {
    expect(PromptTemplate.body('{"a":1}', 'application/json')).toEqual({ a: 1 })
    expect(PromptTemplate.body('hello\u0007 there', 'text/plain')).toBe('hello there')
    expect(PromptTemplate.body('{broken', 'application/json')).toBe('{broken')
    expect(PromptTemplate.body('  ', undefined)).toBeNull()
  })

  it('ends a webhook prompt with a note that inserted values are data', () => {
    expect(PromptTemplate.framing('PR review', ['body.pull_request.title'])).toContain('untrusted external data')
  })
})

describe('GitHub webhook signatures', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}')
  const signature = WebhookSignature.signGitHub({ secret: SECRET, body })

  it('accepts the raw body signed with the secret', () => {
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/u)
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature })).toEqual({ ok: true })
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature: signature.toUpperCase().replace('SHA256=', 'sha256=') })).toEqual({ ok: true })
  })

  it('refuses a tampered body, another secret, a wrong length and non-hex input', () => {
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body: Buffer.from('{"zen":"evil"}'), signature })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(WebhookSignature.verifyGitHub({ secret: 'guessed', body, signature })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature: `sha256=${'a'.repeat(63)}` })).toEqual({ ok: false, reason: 'malformed-signature' })
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature: 'sha256=zzzz' })).toEqual({ ok: false, reason: 'malformed-signature' })
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature: 'sha1=abc' })).toEqual({ ok: false, reason: 'malformed-signature' })
  })

  it('keeps the timestamped scheme separate: a body signed for one scheme does not verify under the other', () => {
    const timestamp = String(now / 1000)
    const timestamped = WebhookSignature.sign({ secret: SECRET, timestamp, body })
    expect(WebhookSignature.verifyGitHub({ secret: SECRET, body, signature: timestamped })).toEqual({ ok: false, reason: 'bad-signature' })
    expect(
      WebhookSignature.verify({
        secret: SECRET,
        body,
        signature: WebhookSignature.signGitHub({ secret: SECRET, body }),
        timestamp,
        now,
        guard: new ReplayGuard(),
      }),
    ).toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })
})

describe('GitHub delivery ids', () => {
  it('accepts the shapes GitHub sends and refuses ids that could not name a delivery', () => {
    expect(isDeliveryId('6f5b0a2e-3c4d-4a8f-9f0e-1c2d3e4f5a6b')).toBe(true)
    expect(isDeliveryId('12345678')).toBe(true)
    expect(isDeliveryId('short')).toBe(false)
    expect(isDeliveryId('has space here')).toBe(false)
    expect(isDeliveryId('x'.repeat(65))).toBe(false)
    expect(isDeliveryId('')).toBe(false)
  })

  it('digests the raw bytes, so a reformatted body is a different event', () => {
    expect(bodyDigestOf(Buffer.from('{"a":1}'))).toMatch(/^[0-9a-f]{64}$/u)
    expect(bodyDigestOf(Buffer.from('{"a":1}'))).not.toBe(bodyDigestOf(Buffer.from('{"a": 1}')))
  })
})
