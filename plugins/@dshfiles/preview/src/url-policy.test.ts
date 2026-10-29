import { describe, expect, it } from 'vitest'
import { checkPreviewUrl } from './url-policy.js'

const defaults = { allowedHosts: ['localhost', '127.0.0.1', '::1', '*.localhost'], allowAnyHost: false }

describe('checkPreviewUrl', () => {
  it('accepts loopback dev servers and reads a bare host:port as http', () => {
    expect(checkPreviewUrl({ ...defaults, url: 'localhost:5173' })).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(checkPreviewUrl({ ...defaults, url: 'http://127.0.0.1:3000/a?b=1' })).toEqual({ ok: true, url: 'http://127.0.0.1:3000/a?b=1' })
    expect(checkPreviewUrl({ ...defaults, url: 'http://[::1]:8080/' })).toEqual({ ok: true, url: 'http://[::1]:8080/' })
    expect(checkPreviewUrl({ ...defaults, url: 'https://app.localhost/' }).ok).toBe(true)
    expect(checkPreviewUrl({ ...defaults, url: 'about:blank' })).toEqual({ ok: true, url: 'about:blank' })
  })

  it('refuses remote hosts, look-alike hosts and non-web schemes by default', () => {
    expect(checkPreviewUrl({ ...defaults, url: 'https://example.com' }).ok).toBe(false)
    expect(checkPreviewUrl({ ...defaults, url: 'http://localhost.evil.com' }).ok).toBe(false)
    expect(checkPreviewUrl({ ...defaults, url: 'file:///etc/passwd' }).ok).toBe(false)
    expect(checkPreviewUrl({ ...defaults, url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(checkPreviewUrl({ ...defaults, url: 'chrome://settings' }).ok).toBe(false)
    expect(checkPreviewUrl({ ...defaults, url: 'http://user:pass@localhost/' }).ok).toBe(false)
  })

  it('opens any web host only when allowAnyHost is on', () => {
    expect(checkPreviewUrl({ ...defaults, allowAnyHost: true, url: 'https://example.com' }).ok).toBe(true)
    expect(checkPreviewUrl({ ...defaults, allowAnyHost: true, url: 'file:///etc/passwd' }).ok).toBe(false)
  })

  it('names the setting to change when a host is refused', () => {
    const verdict = checkPreviewUrl({ ...defaults, url: 'https://example.com' })
    expect(verdict.ok ? '' : verdict.reason).toContain('allowedHosts')
  })
})
