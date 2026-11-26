import { describe, expect, it } from 'vitest'
import { EmbedPolicy, type EmbedCheck } from './embed-policy.js'

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
    expect(EmbedPolicy.classifyFraming({})).toEqual({ framing: 'allowed', detail: null })
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: 'default-src *; script-src *' })).toEqual({ framing: 'allowed', detail: null })
    // frame-src governs children of that page, never whether the page itself may be framed.
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: "frame-src 'none'" })).toEqual({ framing: 'allowed', detail: null })
  })

  it('refuses X-Frame-Options deny and sameorigin, which name another origin than the pane', () => {
    expect(EmbedPolicy.classifyFraming({ xFrameOptions: 'DENY' })).toEqual({ framing: 'denied', detail: 'X-Frame-Options: deny' })
    expect(EmbedPolicy.classifyFraming({ xFrameOptions: ' sameorigin ' })).toEqual({ framing: 'denied', detail: 'X-Frame-Options: sameorigin' })
    expect(EmbedPolicy.classifyFraming({ xFrameOptions: 'ALLOW-FROM https://example.com' })).toEqual({
      framing: 'denied',
      detail: 'X-Frame-Options: allow-from https://example.com',
    })
  })

  it('refuses every frame-ancestors list that cannot name the pane', () => {
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: "frame-ancestors 'none'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'none'",
    })
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: "frame-ancestors 'self'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'self'",
    })
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: "frame-ancestors 'self' https://x.com" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'self' https://x.com",
    })
  })

  it('allows a wildcard, and applies every policy header when one refuses', () => {
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: 'frame-ancestors *' })).toEqual({ framing: 'allowed', detail: null })
    expect(EmbedPolicy.classifyFraming({ contentSecurityPolicy: "default-src 'self', frame-ancestors 'none'" })).toEqual({
      framing: 'denied',
      detail: "Content-Security-Policy: frame-ancestors 'none'",
    })
  })
})

describe('embedVerdict', () => {
  it('puts a refusal first, then a dead port, then an open page', () => {
    expect(EmbedPolicy.verdict(check({ framing: 'denied' }))).toBe('refused')
    expect(EmbedPolicy.verdict(check({ framing: 'denied', reachable: false }))).toBe('refused')
    expect(EmbedPolicy.verdict(check({ reachable: false }))).toBe('unreachable')
    expect(EmbedPolicy.verdict(check({}))).toBe('open')
  })
})

describe('normalizeProbeUrl', () => {
  it('reads a bare host:port as http and keeps an http(s) address', () => {
    expect(EmbedPolicy.normalizeProbeUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(EmbedPolicy.normalizeProbeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(EmbedPolicy.normalizeProbeUrl('  http://192.168.1.44:53411/  ')).toBe('http://192.168.1.44:53411/')
  })

  it('refuses what the Host must not request', () => {
    expect(EmbedPolicy.normalizeProbeUrl('')).toBeUndefined()
    expect(EmbedPolicy.normalizeProbeUrl('file:///etc/passwd')).toBeUndefined()
    expect(EmbedPolicy.normalizeProbeUrl('javascript:alert(1)')).toBeUndefined()
    expect(EmbedPolicy.normalizeProbeUrl('http://user:secret@example.com/')).toBeUndefined()
    expect(EmbedPolicy.normalizeProbeUrl('not a url')).toBeUndefined()
  })
})
