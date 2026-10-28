import { SecretReferenceResolver } from '@dshfiles/credential-port'
import { describe, expect, it } from 'vitest'
import { braveSearchSettings } from '../src/settings.js'

describe('personal credential configuration', () => {
  it('starts unbound and does not activate a vault alias implicitly', async () => {
    const settings = braveSearchSettings.schema({})
    expect(settings.apiKey).toBe('')
    await expect(SecretReferenceResolver.resolve({ referenceText: settings.apiKey, values: undefined, environmentValue: undefined })).resolves.toBeUndefined()
  })

  it('retains the explicit environment fallback with an empty setting', async () => {
    const settings = braveSearchSettings.schema({})
    await expect(SecretReferenceResolver.resolve({ referenceText: settings.apiKey, values: undefined, environmentValue: 'synthetic-env-key' })).resolves.toBe(
      'synthetic-env-key',
    )
  })

  it('preserves and resolves a user-stored reference instead of selecting another alias', async () => {
    const settings = braveSearchSettings.schema({ apiKey: 'secret:SYNTHETIC_SEARCH@dev' })
    expect(settings.apiKey).toBe('secret:SYNTHETIC_SEARCH@dev')
    await expect(
      SecretReferenceResolver.resolve({
        referenceText: settings.apiKey,
        values: {
          resolve: async input => {
            expect(input).toEqual({ reference: { alias: 'SYNTHETIC_SEARCH', environment: 'dev' }, cwd: null })
            return 'synthetic-vault-key'
          },
        },
        environmentValue: 'synthetic-env-key',
      }),
    ).resolves.toBe('synthetic-vault-key')
  })
})
