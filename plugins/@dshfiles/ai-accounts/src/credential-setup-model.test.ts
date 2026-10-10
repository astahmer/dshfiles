import { describe, expect, it } from 'vitest'
import { shouldOfferCredentialSetup, type CredentialSetupVisibilityInput } from './credential-setup-model.js'

const selectedKeyedAccount = (): CredentialSetupVisibilityInput => ({
  setupAvailable: true,
  draftInstanceId: 'open-code-go-alex',
  selectedInstanceId: 'open-code-go-alex',
  accountKind: 'opencode-go',
})

describe('API-key setup visibility', () => {
  it('offers setup for a selected keyed account even when its key already exists', () => {
    expect(shouldOfferCredentialSetup(selectedKeyedAccount())).toBe(true)
  })

  it('does not offer a key action for Codex or when setup is unavailable or another account is selected', () => {
    const input = selectedKeyedAccount()
    expect(shouldOfferCredentialSetup({ ...input, accountKind: 'codex' })).toBe(false)
    expect(shouldOfferCredentialSetup({ ...input, setupAvailable: false })).toBe(false)
    expect(shouldOfferCredentialSetup({ ...input, selectedInstanceId: 'different-account' })).toBe(false)
  })
})
