import { describe, expect, it } from 'vitest'
import { UsageQuota } from './quota-tab.js'

describe('UsageQuota', () => {
  it('lands on the requested view and account, and keeps the view when only an account is given', () => {
    UsageQuota.go({ view: 'history', accountId: 'commandcode_work' })
    expect(UsageQuota.current()).toMatchObject({ view: 'history', accountId: 'commandcode_work' })
    const visit = UsageQuota.current().visit
    UsageQuota.go({ accountId: 'codex' })
    expect(UsageQuota.current()).toMatchObject({ view: 'history', accountId: 'codex', visit: visit + 1 })
  })
})
