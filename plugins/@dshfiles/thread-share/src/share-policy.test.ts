import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { RateLimiter } from './rate-limit.js'
import { redactText } from './redact.js'
import { SharePage } from './share-page.js'
import { SharePolicy, TOKEN_PATTERN } from './share-policy.js'
import { chunkEntries } from './share-store.js'

it('generates unguessable link tokens and stores only their digest', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => SharePolicy.generateToken()))
  expect(tokens.size).toBe(200)
  for (const token of tokens) expect(token).toMatch(TOKEN_PATTERN)
  const token = SharePolicy.generateToken()
  expect(SharePolicy.tokenDigest(token)).toMatch(/^[0-9a-f]{64}$/)
  expect(SharePolicy.tokenDigest(token)).not.toContain(token.slice(5))
})

it('hashes a passphrase with a fresh salt and verifies only the same passphrase', async () => {
  const first = await Effect.runPromise(SharePolicy.hashPassphrase('correct horse battery'))
  const second = await Effect.runPromise(SharePolicy.hashPassphrase('correct horse battery'))
  expect(first.algorithm).toBe('scrypt')
  expect(first.salt).not.toBe(second.salt)
  expect(first.hash).not.toBe(second.hash)
  expect(JSON.stringify(first)).not.toContain('correct horse')
  expect(await Effect.runPromise(SharePolicy.verifyPassphrase({ stored: first, presented: 'correct horse battery' }))).toBe(true)
  expect(await Effect.runPromise(SharePolicy.verifyPassphrase({ stored: first, presented: 'correct horse batter' }))).toBe(false)
  expect(await Effect.runPromise(SharePolicy.verifyPassphrase({ stored: first, presented: '' }))).toBe(false)
}, 60_000)

it('computes expiry from the preset and reports expired and revoked shares', () => {
  const now = 1_000_000
  expect(SharePolicy.expiresAt({ preset: '1h', now })).toBe(now + 3_600_000)
  expect(SharePolicy.expiresAt({ preset: '1d', now })).toBe(now + 86_400_000)
  expect(SharePolicy.expiresAt({ preset: '7d', now })).toBe(now + 7 * 86_400_000)
  expect(SharePolicy.expiresAt({ preset: 'never', now })).toBeNull()
  expect(SharePolicy.status({ revokedAt: null, expiresAt: now + 1, now })).toBe('active')
  expect(SharePolicy.status({ revokedAt: null, expiresAt: now, now })).toBe('expired')
  expect(SharePolicy.status({ revokedAt: null, expiresAt: null, now: Number.MAX_SAFE_INTEGER })).toBe('active')
  expect(SharePolicy.status({ revokedAt: now - 1, expiresAt: null, now })).toBe('revoked')
})

it('redacts secrets, the workspace path and home paths from transcript text', () => {
  const text = [
    'export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123',
    'token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB and AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz',
    'password: hunter2hunter2',
    'git clone https://deploy:s3cretpass@example.com/repo.git',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
    'a share link dshs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'see /Users/alice/work/app/src/index.ts and /home/bob/.ssh/config and C:\\Users\\carol\\notes.txt',
    'kept: secret:OPENAI_API_KEY is a reference, not a value',
  ].join('\n')
  const result = redactText(text, { workspace: '/Users/alice/work/app', home: '/Users/alice' })
  for (const leaked of [
    'sk-proj-',
    'ghp_0123',
    'AKIAABCD',
    'abcdefghijklmnop.qrs',
    'hunter2',
    's3cretpass',
    'deploy:',
    'b3BlbnNzaC1',
    'dshs_AAAA',
    'alice',
    'bob',
    'carol',
  ]) {
    expect(result.text).not.toContain(leaked)
  }
  expect(result.text).toContain('<workspace>/src/index.ts')
  expect(result.text).toContain('~/.ssh/config')
  expect(result.text).toContain('secret:OPENAI_API_KEY')
  expect(result.rules).toEqual(expect.arrayContaining(['anthropic-openai-key', 'github-token', 'aws-access-key', 'bearer', 'private-key', 'workspace-path']))
})

it('escapes every transcript character before applying code and paragraph markup', () => {
  const html = SharePage.message('<script>alert(1)</script> and `<b>`\n\n```js\nconst x = "<img onerror=x>"\n```')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('<code>&lt;b&gt;</code>')
  expect(html).toContain('<pre><code>const x = &quot;&lt;img onerror=x&gt;&quot;</code></pre>')
  const page = SharePage.transcript({ title: '<x>', entries: [], mode: 'export', capturedAt: 0, expiresAt: null, truncated: false })
  expect(page).toContain('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">')
  expect(page).not.toMatch(/<script|<link |src=/)
})

it('limits requests per window and resets after it', () => {
  const limiter = new RateLimiter({ limit: 3, windowMs: 1_000 })
  expect([1, 2, 3].map(() => limiter.hit('a', 0).allowed)).toEqual([true, true, true])
  expect(limiter.hit('a', 10)).toEqual({ allowed: false, retryAfterSeconds: 1 })
  expect(limiter.hit('b', 10).allowed).toBe(true)
  expect(limiter.hit('a', 1_000).allowed).toBe(true)
})

it('splits a large snapshot into chunks under the storage value limit', () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({ role: 'assistant' as const, text: `${String(index)}${'é'.repeat(7_999)}` }))
  const chunks = chunkEntries(entries)
  expect(chunks.flat()).toEqual(entries)
  for (const chunk of chunks) expect(Buffer.byteLength(JSON.stringify(chunk), 'utf8')).toBeLessThan(256 * 1024)
})
