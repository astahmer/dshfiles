import { describe, expect, test } from 'vitest'
import { redactSecrets } from '../src/redact.js'

describe('redactSecrets', () => {
  test('hides the launch token in a runtime log tail without truncating it', () => {
    const tail = `${'x'.repeat(1200)}\nDSH ready at http://127.0.0.1:4100/?token=s3cr3t&thread=a\nCookie: dsh=abc; other`
    const redacted = redactSecrets(tail)
    expect(redacted).not.toContain('s3cr3t')
    expect(redacted).not.toContain('dsh=abc')
    expect(redacted).toContain('?token=[redacted]&thread=a')
    expect(redacted.length).toBeGreaterThan(1200)
  })

  test('hides a bearer or basic credential after its scheme, and token-like JSON fields', () => {
    const tail = [
      'request failed: authorization: Bearer abc.DEF-123 (401)',
      'Authorization=Basic dXNlcjpwYXNz',
      '{"token":"tok-1","accessToken": "tok-2","refresh_token":"tok-3","authorization":"Bearer tok-4","password":"tok-5","name":"keep"}',
    ].join('\n')
    const redacted = redactSecrets(tail)
    for (const secret of ['abc.DEF-123', 'dXNlcjpwYXNz', 'tok-1', 'tok-2', 'tok-3', 'tok-4', 'tok-5']) expect(redacted).not.toContain(secret)
    expect(redacted).toContain('(401)')
    expect(redacted).toContain('"name":"keep"')
  })
})
