import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { accountProfileSchema, type AccountProfile, type UsageCard } from './api.js'
import { accountUsageCard } from './account-usage-card.js'

const profile = (input: { readonly useExtraUsage?: boolean }): AccountProfile => {
  const fields = {
    instanceId: 'claude_work',
    kind: 'claude',
    displayName: 'ClaudeWork',
    enabled: true,
    homePath: '',
    shadowHomePath: '',
    apiKeyEnv: '',
    apiBaseUrl: '',
    badge: 'CW',
    accentColor: 'orange',
    providerIcon: 'Sparkles',
    mode: 'direct',
    signedIn: true,
    identity: null,
    plan: 'team',
    state: 'healthy',
    loginHint: '',
    detail: null,
  }
  return Schema.decodeUnknownSync(accountProfileSchema)(input.useExtraUsage === undefined ? fields : { ...fields, useExtraUsage: input.useExtraUsage })
}

const providerExtraUsageOn: UsageCard = {
  status: 'ok',
  message: null,
  identity: null,
  plan: 'team',
  windows: [{ label: 'Current session', percentRemaining: 82, resetsAt: 1 }],
  bankedResets: 0,
  bankedResetExpiries: [],
  extraUsage: { enabled: true, used: 169.91, monthlyLimit: 200, currency: 'EUR', percentUsed: 84.955, resetsAt: null },
}

describe('account usage card', () => {
  it('carries DSH’s gate beside a provider that keeps reporting its own extra usage on', () => {
    const card = accountUsageCard({ account: profile({ useExtraUsage: false }), usage: providerExtraUsageOn })
    expect(card.useExtraUsage).toBe(false)
    expect(card.usage.extraUsage?.enabled).toBe(true)
  })

  it('reports the gate as provisionally off for an account that never set it', () => {
    expect(accountUsageCard({ account: profile({}), usage: providerExtraUsageOn }).useExtraUsage).toBe(false)
  })

  it('reports the gate on once the user allowed it', () => {
    expect(accountUsageCard({ account: profile({ useExtraUsage: true }), usage: providerExtraUsageOn }).useExtraUsage).toBe(true)
  })
})
