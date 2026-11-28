import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FastModeRetry } from '../src/fast-mode-section.js'

describe('Fast mode appears once a late catalog says so (council picker round 5, U3)', () => {
  it('asks again while the route reads unavailable, five times at most, and never once it is known', () => {
    expect(FastModeRetry.shouldRetry({ status: { available: false }, retries: 0 })).toBe(true)
    expect(FastModeRetry.shouldRetry({ status: { available: false }, retries: 4 })).toBe(true)
    expect(FastModeRetry.shouldRetry({ status: { available: false }, retries: 5 })).toBe(false)
    expect(FastModeRetry.shouldRetry({ status: { available: true }, retries: 0 })).toBe(false)
    expect(FastModeRetry.shouldRetry({ status: undefined, retries: 0 })).toBe(false)
  })

  it('refetches on a timer from the section, and starts over for another route', () => {
    const source = readFileSync(new URL('../src/fast-mode-section.ts' + 'x', import.meta.url), 'utf8')
    expect(source).toMatch(/FastModeRetry\.shouldRetry\(\{ status, retries \}\)[\s\S]{0,200}refetch\(\)/u)
    expect(source).toContain('useEffect(() => setRetries(0), [sessionId, provider, model])')
  })
})
