import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { detectTailnet, serveTailnet, Tailnet } from '../src/tailnet.ts'

describe('Tailnet.parseName', () => {
  it('accepts a tailnet DNS name and strips the trailing dot', () => {
    expect(Tailnet.parseName('{"Self":{"DNSName":"box.tail1234.ts.net."}}')).toBe('box.tail1234.ts.net')
  })

  it('rejects foreign, malformed and missing names', () => {
    expect(Tailnet.parseName('{"Self":{"DNSName":"box.example.com."}}')).toBeUndefined()
    expect(Tailnet.parseName('{"Self":{}}')).toBeUndefined()
    expect(Tailnet.parseName('{}')).toBeUndefined()
    expect(() => Tailnet.parseName('not json')).toThrow()
  })
})

describe('detectTailnet', () => {
  it('records one bounded span even when Tailscale is absent', async () => {
    using recorder = recordSpans()
    await detectTailnet()
    expect(recorder.named('phone access tailnet')).toHaveLength(1)
    const metadata = JSON.stringify(recorder.spans.map(span => ({ attributes: span.attributes, status: span.status })))
    expect(metadata).not.toContain('ts.net')
  })
})

describe('serveTailnet', () => {
  it('records one bounded span and refuses an invalid port without running Tailscale', async () => {
    using recorder = recordSpans()
    await expect(serveTailnet(0)).resolves.toBe(false)
    expect(recorder.named('phone access serve')).toHaveLength(1)
  })
})
