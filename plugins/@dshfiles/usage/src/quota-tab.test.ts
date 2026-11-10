import { describe, expect, it } from 'vitest'
import { UsageQuota } from './quota-tab.js'

describe('UsageQuota', () => {
  it('routes navigation to one occurrence', () => {
    UsageQuota.go({ view: 'forecast', accountId: 'first' }, 'first-panel')
    UsageQuota.go({ view: 'history', accountId: 'second' }, 'second-panel')
    expect(UsageQuota.current('first-panel')).toMatchObject({ view: 'forecast', accountId: 'first' })
    expect(UsageQuota.current('second-panel')).toMatchObject({ view: 'history', accountId: 'second' })
    expect(UsageQuota.current('another-panel')).toMatchObject({ view: 'accounts', visit: 0 })
  })
  it('lands on the requested view and account, and keeps the view when only an account is given', () => {
    UsageQuota.go({ view: 'history', accountId: 'commandcode_work' })
    expect(UsageQuota.current()).toMatchObject({ view: 'history', accountId: 'commandcode_work' })
    const visit = UsageQuota.current().visit
    UsageQuota.go({ accountId: 'codex' })
    expect(UsageQuota.current()).toMatchObject({ view: 'history', accountId: 'codex', visit: visit + 1 })
  })
})
