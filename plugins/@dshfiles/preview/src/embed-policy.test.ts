import { describe, expect, it } from 'vitest'
import { classifyFraming, embedVerdict, normalizeProbeUrl, type EmbedCheck } from './embed-policy.js'

const check = (input: Partial<EmbedCheck>): EmbedCheck => ({
  url: 'http://localhost:5173/',
  reachable: true,
  status: 200,
  framing: 'allowed',
  detail: null,
  ...input,
})

describe('classifyFraming', () => {
  it('allows a page that sends no framing header at all', () => {
    expect(classifyFraming({})).toEqual({ framing: 'allowed', detail: null })
    expect(classifyFraming({ contentSecurityPolicy: 'default-src *; script-src *' })).toEqual({ framing: 'allowed', detail: null })
    // frame-src governs children of that page, never whether the page itself may be framed.
    expect(classifyFraming({ contentSecurityPolicy: "frame-src 'none'" })).toEqual({ framing: 'allowed', detail: null })
  })

  it('refuses X-Frame-Options deny and sameorigin, which name another origin than the pane', () => {
    expect(classifyFraming({ xFrameOptions: 'DENY' })).toEqual({ framing: 'denied', detail: 'X-Frame-Options: deny' })
    expect(classifyFraming({ xFrameOptions: ' sameorigin ' })).toEqual({ framing: 'denied', detail: 'X-Frame-Options: sameorigin' })
    expect(classifyFraming({ xFrameOptions: 'ALLOW-FROM https://example.com' })).toEqual({
      framing: 'denied',
      detail: 'X-Frame-Options: allow-from https://example.com',
    })
  })

  it('refuses every frame-ancestors list that cannot name the pane', () => {
    expect(classifyFraming({ contentSecurityPolicy: "frame-ancestors 'none'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'none'",
    })
    expect(classifyFraming({ contentSecurityPolicy: "frame-ancestors 'self'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'self'",
    })
    expect(classifyFraming({ contentSecurityPolicy: "frame-ancestors 'self' https://x.com" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'self' https://x.com",
    })
  })

  it('allows a wildcard, and applies every policy header when one refuses', () => {
    expect(classifyFraming({ contentSecurityPolicy: 'frame-ancestors *' })).toEqual({ framing: 'allowed', detail: null })
    expect(classifyFraming({ contentSecurityPolicy: "default-src 'self', frame-ancestors 'none'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'none'",
    })
  })
})

describe('embedVerdict', () => {
  it('puts a refusal first, then a dead port, then an open page', () => {
    expect(embedVerdict(check({ framing: 'denied' }))).toBe('refused')
    expect(embedVerdict(check({ framing: 'denied', reachable: false }))).toBe('refused')
    expect(embedVerdict(check({ reachable: false }))).toBe('unreachable')
    expect(embedVerdict(check({}))).toBe('open')
  })
})

describe('normalizeProbeUrl', () => {
  it('reads a bare host:port as http and keeps an http(s) address', () => {
    expect(normalizeProbeUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeProbeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeProbeUrl('  http://192.168.1.44:53411/  ')).toBe('http://192.168.1.44:53411/')
  })

  it('refuses what the Host must not request', () => {
    expect(normalizeProbeUrl('')).toBeUndefined()
    expect(normalizeProbeUrl('file:///etc/passwd')).toBeUndefined()
    expect(normalizeProbeUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeProbeUrl('http://user:secret@example.com/')).toBeUndefined()
    expect(normalizeProbeUrl('not a url')).toBeUndefined()
  })
})
