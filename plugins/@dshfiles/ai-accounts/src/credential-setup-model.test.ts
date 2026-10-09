import { describe, expect, it } from 'vitest'
import { shouldOfferCredentialSetup, type CredentialSetupVisibilityInput } from './credential-setup-model.js'

const missingCredential = (): CredentialSetupVisibilityInput => ({
  setupAvailable: true,
  draftInstanceId: 'open-code-go-alex',
  selectedInstanceId: 'open-code-go-alex',
  selectedSignedIn: false,
  apiKeyEnv: 'OPENCODEX_OPENCODE_GO_API_KEY',
  credentialInfo: { configured: false, writable: true },
})

describe('API-key setup visibility', () => {
  it('offers setup for a missing key on the active account', () => {
    expect(shouldOfferCredentialSetup(missingCredential())).toBe(true)
  })

  it('does not confuse configured-key request failures such as a provider 404 with missing credentials', () => {
    const input = missingCredential()
    expect(shouldOfferCredentialSetup({ ...input, selectedSignedIn: true, credentialInfo: { configured: true, writable: true } })).toBe(false)
  })

  it('does not offer setup for read-only, invalid, unavailable, or non-selected references', () => {
    const input = missingCredential()
    expect(shouldOfferCredentialSetup({ ...input, credentialInfo: { configured: false, writable: false } })).toBe(false)
    expect(shouldOfferCredentialSetup({ ...input, apiKeyEnv: 'PATH' })).toBe(false)
    expect(shouldOfferCredentialSetup({ ...input, setupAvailable: false })).toBe(false)
    expect(shouldOfferCredentialSetup({ ...input, selectedInstanceId: 'different-account' })).toBe(false)
  })
})
