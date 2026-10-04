import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoveryCatalogOptions, readKeyFromEnv } from './credentials.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readKeyFromEnv', () => {
  it('reads a variable named as an API key', () => {
    vi.stubEnv('DSHFILES_TEST_API_KEY', ' secret ')
    expect(readKeyFromEnv('DSHFILES_TEST_API_KEY')).toBe('secret')
  })

  it('refuses any other variable even when it is set', () => {
    vi.stubEnv('DSHFILES_TEST_SECRET', 'secret')
    expect(readKeyFromEnv('DSHFILES_TEST_SECRET')).toBe('')
  })
})

describe('discoveryCatalogOptions', () => {
  const stored = { apiBaseUrl: 'https://api.commandcode.ai', keyEnv: 'DSHFILES_TEST_API_KEY' }

  it('treats the request key as a value, not a variable name', () => {
    vi.stubEnv('DSHFILES_TEST_API_KEY', 'stored')
    expect(discoveryCatalogOptions({ apiKey: 'typed', baseURL: 'https://eu.commandcode.ai' }, stored)).toEqual({
      baseUrl: 'https://eu.commandcode.ai',
      apiKey: 'typed',
    })
  })

  it('never sends the stored key to a draft base', () => {
    vi.stubEnv('DSHFILES_TEST_API_KEY', 'stored')
    expect(discoveryCatalogOptions({ baseURL: 'https://attacker.example' }, stored)).toEqual({
      baseUrl: 'https://api.commandcode.ai',
      apiKey: 'stored',
    })
  })
})
