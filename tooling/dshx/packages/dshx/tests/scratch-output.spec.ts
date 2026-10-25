import { describe, expect, it } from 'vitest'
import { ScratchProfileRuntime } from '../src/project/scratch-profile.js'

describe('scratch startup output redaction', () => {
  it.each([
    'http://127.0.0.1:34567/?token=synthetic-private-token',
    'http://localhost:34567/?token=synthetic-private-token',
    'http://192.0.2.10:34567/?token=synthetic-private-token',
    'http://[::1]:34567/?token=synthetic-private-token',
    'https://[2001:db8::1]:34567/?token=synthetic-private-token',
    'https://example.invalid/dsh/?token=synthetic-private-token',
    'https://synthetic-user:synthetic-password@example.invalid/dsh/?token=synthetic-private-token',
  ])('removes launch credentials from any advertised authority: %s', url => {
    const output = ScratchProfileRuntime.redactHostOutput(`dsh web: ${url}\n`)
    expect(output).toBe(`dsh web: ${new URL(url).origin}/[redacted]\n`)
    expect(output).not.toContain('synthetic-private-token')
    expect(output).not.toContain('synthetic-password')
    expect(output).not.toContain('synthetic-user')
  })

  it('preserves labels and order for multiple startup addresses', () => {
    expect(ScratchProfileRuntime.redactHostOutput('dsh web: http://localhost:34567/?token=private\n  LAN: http://192.0.2.10:34567/?token=private\n')).toBe(
      'dsh web: http://localhost:34567/[redacted]\n  LAN: http://192.0.2.10:34567/[redacted]\n',
    )
  })

  it('does not throw or retain credentials from malformed URL-shaped diagnostics', () => {
    expect(ScratchProfileRuntime.redactHostOutput('URL: http://[invalid/?token=synthetic-private-token')).toBe('URL: [redacted-url]')
  })
})
