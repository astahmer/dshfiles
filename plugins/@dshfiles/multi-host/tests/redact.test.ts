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
})
