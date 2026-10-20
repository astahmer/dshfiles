import type { SecretReferenceResolution } from '@dshfiles/credential-port'
import { describe, expect, it } from 'vitest'
import { BacklogTriageKey } from './triage-key.js'

const resolving = (value: string, calls: SecretReferenceResolution[] = []) => ({
  resolve: async (input: SecretReferenceResolution) => {
    calls.push(input)
    return value
  },
})

describe('the Jev key', () => {
  it('resolves a bound reference on the Host and asks for no folder', async () => {
    const calls: SecretReferenceResolution[] = []
    await expect(
      BacklogTriageKey.resolve({ referenceText: 'secret:TYPESAFE_KEY@dev', values: resolving('resolved-secret', calls), environmentKey: 'env-key' }),
    ).resolves.toBe('resolved-secret')
    expect(calls).toEqual([{ reference: { alias: 'TYPESAFE_KEY', environment: 'dev' }, cwd: null }])
  })

  it('falls back to the Host environment when no reference is bound', async () => {
    await expect(BacklogTriageKey.resolve({ referenceText: '  ', values: resolving('unused'), environmentKey: 'env-key' })).resolves.toBe('env-key')
    await expect(BacklogTriageKey.resolve({ referenceText: '', values: undefined, environmentKey: '' })).resolves.toBeUndefined()
  })

  it('refuses a bound key that is not a reference, and a reference with no catalog to resolve it', async () => {
    await expect(BacklogTriageKey.resolve({ referenceText: 'TYPESAFE_API_KEY', values: resolving('unused'), environmentKey: 'env-key' })).rejects.toThrow(
      'is not a secret:ALIAS or secret:ALIAS@env reference',
    )
    await expect(BacklogTriageKey.resolve({ referenceText: 'secret:TYPESAFE_KEY', values: undefined, environmentKey: 'env-key' })).rejects.toThrow(
      'Secret Catalog plugin is not loaded',
    )
  })
})
