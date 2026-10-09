import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoveryCatalogOptions, readKeyFromEnv, resolveKeyFromProvider } from './credentials.js'

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

describe('resolveKeyFromProvider', () => {
  it('reads the provider-managed value on every operation', async () => {
    let value = 'synthetic-first-key'
    const provider = { resolve: async () => ({ value, source: 'file' }) }

    expect(await resolveKeyFromProvider(provider, 'DSHFILES_TEST_API_KEY')).toBe('synthetic-first-key')
    value = 'synthetic-next-key'
    expect(await resolveKeyFromProvider(provider, 'DSHFILES_TEST_API_KEY')).toBe('synthetic-next-key')
  })

  it('uses the process environment only when the DSH credential provider is absent', async () => {
    vi.stubEnv('DSHFILES_TEST_API_KEY', 'environment-key')
    expect(await resolveKeyFromProvider(undefined, 'DSHFILES_TEST_API_KEY')).toBe('environment-key')
    expect(await resolveKeyFromProvider(undefined, 'DSHFILES_TEST_SECRET')).toBe('')
  })

  it('refuses invalid reference names before asking the provider', async () => {
    let reads = 0
    const provider = { resolve: async () => { reads += 1; return undefined } }

    expect(await resolveKeyFromProvider(provider, 'PATH')).toBe('')
    expect(reads).toBe(0)
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
