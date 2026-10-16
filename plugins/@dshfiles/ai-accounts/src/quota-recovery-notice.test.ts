import { describe, expect, it } from 'vitest'
import { showsQuotaRecoveryNotice } from './quota-recovery-notice.js'

describe('inline quota recovery notice visibility', () => {
  it('stays absent when the per-turn choice is switched off', () => {
    expect(showsQuotaRecoveryNotice({ showChoice: false, failoverEnabled: false, hasRecovery: true })).toBe(false)
    expect(showsQuotaRecoveryNotice({ showChoice: false, failoverEnabled: true, hasRecovery: false })).toBe(false)
  })

  it('explains the stop while exhausted-limit failover is off, with or without a recovery', () => {
    expect(showsQuotaRecoveryNotice({ showChoice: true, failoverEnabled: false, hasRecovery: false })).toBe(true)
    expect(showsQuotaRecoveryNotice({ showChoice: true, failoverEnabled: false, hasRecovery: true })).toBe(true)
  })

  it('appears with failover on only when the ladder still stored a recovery to act on', () => {
    expect(showsQuotaRecoveryNotice({ showChoice: true, failoverEnabled: true, hasRecovery: true })).toBe(true)
    expect(showsQuotaRecoveryNotice({ showChoice: true, failoverEnabled: true, hasRecovery: false })).toBe(false)
  })
})
