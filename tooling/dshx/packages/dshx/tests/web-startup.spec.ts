import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { readWebStartupOverrides } from '../src/host/web-startup.js'

describe('native Web startup override boundary', () => {
  it('does not invent overrides when no Web startup service exists', () => {
    expect(readWebStartupOverrides(new Context())).toEqual({})
  })

  it('keeps explicit port zero and only the exported binding fields', () => {
    const ctx = new Context()
    ctx.provide('webStartup', { openBrowser: false, host: '127.0.0.1', port: 0, trustedHosts: [], publicUrl: 'http://example.invalid/' })
    expect(readWebStartupOverrides(ctx)).toEqual({ host: '127.0.0.1', port: 0 })
  })

  it('distinguishes omitted CLI flags from composed defaults', () => {
    const ctx = new Context()
    ctx.provide('webStartup', { openBrowser: false, trustedHosts: [] })
    expect(readWebStartupOverrides(ctx)).toEqual({})
  })

  it('rejects malformed native binding values instead of exposing an unchecked service', () => {
    const ctx = new Context()
    ctx.provide('webStartup', { host: 123, port: -1 })
    expect(() => readWebStartupOverrides(ctx)).toThrow()
  })
})
