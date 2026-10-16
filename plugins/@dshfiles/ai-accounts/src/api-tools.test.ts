import { describe, expect, test } from 'vitest'
import { aiAccountsApi } from './api.js'

describe('ai-accounts tool exposure', () => {
  test('every account and quota action a human can take is a named tool', () => {
    const tools = Object.values(aiAccountsApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'ai_accounts_catalog',
      'ai_accounts_collect_usage',
      'ai_accounts_continuations',
      'ai_accounts_history',
      'ai_accounts_identity',
      'ai_accounts_move_account',
      'ai_accounts_native_providers',
      'ai_accounts_pricing_status',
      'ai_accounts_quota',
      'ai_accounts_refresh_pricing',
      'ai_accounts_refresh_quota',
      'ai_accounts_resume_continuation',
      'ai_accounts_set_auto_retry',
      'ai_accounts_set_distribution',
      'ai_accounts_set_native_provider',
      'ai_accounts_snooze_continuation',
    ])
  })

  test('inspection stays read-only and every tool explains itself', () => {
    const readOnly = Object.values(aiAccountsApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'ai_accounts_catalog',
      'ai_accounts_continuations',
      'ai_accounts_history',
      'ai_accounts_identity',
      'ai_accounts_native_providers',
      'ai_accounts_pricing_status',
      'ai_accounts_quota',
    ])
    for (const method of Object.values(aiAccountsApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
    }
  })

  test('every write tool says it needs the user to have asked', () => {
    const writes = Object.values(aiAccountsApi.methods).filter(method => method.tool !== undefined && method.tool.readOnly !== true)
    expect(writes.length).toBeGreaterThan(0)
    for (const method of writes) {
      expect(method.description ?? '').toMatch(/Call only when the user asked/u)
    }
  })
})
