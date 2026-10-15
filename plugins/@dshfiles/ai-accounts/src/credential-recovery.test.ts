import { describe, expect, it } from 'vitest'
import { isCredentialRecoveryFailure } from './credential-recovery.js'

describe('credential recovery actions', () => {
  it('offers setup for a missing credential failure', () => {
    expect(isCredentialRecoveryFailure({ code: 'MISSING_CREDENTIAL' })).toBe(true)
  })

  it.each(['AUTH', 'INVALID_CREDENTIAL', 'ACCOUNT_SIGNED_OUT', 'ACCOUNT_SIGN_IN_REQUIRED'])('offers setup for %s failures', code => {
    expect(isCredentialRecoveryFailure({ code })).toBe(true)
  })

  it.each([401, 403])('offers setup for HTTP %s authentication failures', status => {
    expect(isCredentialRecoveryFailure({ code: 'UNKNOWN', status })).toBe(true)
  })

  it('does not offer credential setup for unrelated failures', () => {
    expect(isCredentialRecoveryFailure({ code: 'RATE_LIMIT', status: 429 })).toBe(false)
    expect(isCredentialRecoveryFailure({ code: 'TRANSPORT', status: 503 })).toBe(false)
  })
})
