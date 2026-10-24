import { describe, expect, test, it } from 'vitest'
import { AccountsHostApiModel } from './accounts-host-api.js'
import { aiAccountsApi } from './api.js'

describe('ai-accounts tool exposure', () => {
  test('every account and quota action a human can take is a named tool', () => {
    const tools = Object.values(aiAccountsApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'ai_accounts_begin_copilot_login',
      'ai_accounts_cancel_copilot_login',
      'ai_accounts_catalog',
      'ai_accounts_collect_usage',
      'ai_accounts_complete_setup_account',
      'ai_accounts_continuations',
      'ai_accounts_copilot_login_status',
      'ai_accounts_create_setup_account',
      'ai_accounts_dismiss_continuation',
      'ai_accounts_fast_mode_history',
      'ai_accounts_history',
      'ai_accounts_identity',
      'ai_accounts_move_account',
      'ai_accounts_native_providers',
      'ai_accounts_pricing_status',
      'ai_accounts_quota',
      'ai_accounts_refresh_pricing',
      'ai_accounts_refresh_quota',
      'ai_accounts_resume_continuation',
      'ai_accounts_save_account',
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
      'ai_accounts_copilot_login_status',
      'ai_accounts_fast_mode_history',
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

it('keeps Copilot instructions out of raw agent/plugin responses and requires cancellation consent', async () => {
  const waiting = {
    instanceId: 'copilot',
    status: 'waiting' as const,
    userCode: 'TEST-CODE',
    verificationUri: 'https://github.com/login/device',
    message: null,
  }
  expect(AccountsHostApiModel.copilotForCaller(waiting, { kind: 'client' })).toEqual(waiting)
  for (const caller of [
    { kind: 'agent', sessionId: 'test-agent' },
    { kind: 'plugin', packageId: '@test/plugin' },
  ] as const) {
    expect(AccountsHostApiModel.copilotForCaller(waiting, caller)).toEqual({ ...waiting, userCode: null, verificationUri: null })
  }
  for (const method of [aiAccountsApi.methods.beginCopilotLogin, aiAccountsApi.methods.copilotLoginStatus]) {
    expect(method.tool?.render?.(waiting)).not.toMatch(/TEST-CODE|github.com/u)
  }
  const schema = aiAccountsApi.methods.cancelCopilotLogin.input
  if (schema === undefined) throw new Error('Cancellation requires a schema')
  expect((await schema['~standard'].validate({ instanceId: 'copilot' })).issues).toBeDefined()
  expect((await schema['~standard'].validate({ instanceId: 'copilot', confirm: true })).issues).toBeUndefined()
})
