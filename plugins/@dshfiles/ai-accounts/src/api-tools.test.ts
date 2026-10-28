import { describe, expect, test } from 'vitest'
import { aiAccountsApi, type CopilotLoginState } from './api.js'
import { AccountsHostApiModel } from './accounts-host-api.js'

describe('ai-accounts tool exposure', () => {
  test('every account and quota action a human can take is a named tool', () => {
    const tools = Object.values(aiAccountsApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'ai_accounts_begin_copilot_login',
      'ai_accounts_cancel_copilot_login',
      'ai_accounts_catalog',
      'ai_accounts_collect_usage',
      'ai_accounts_complete_connection',
      'ai_accounts_configure_connection',
      'ai_accounts_connection',
      'ai_accounts_continuations',
      'ai_accounts_copilot_login_status',
      'ai_accounts_create_setup_account',
      'ai_accounts_discard_connection',
      'ai_accounts_dismiss_continuation',
      'ai_accounts_fast_mode_history',
      'ai_accounts_history',
      'ai_accounts_identity',
      'ai_accounts_import_connection_key',
      'ai_accounts_move_account',
      'ai_accounts_native_providers',
      'ai_accounts_prepare_connection',
      'ai_accounts_pricing_status',
      'ai_accounts_quota',
      'ai_accounts_refresh_pricing',
      'ai_accounts_refresh_quota',
      'ai_accounts_reorder_account',
      'ai_accounts_resume_continuation',
      'ai_accounts_save_account',
      'ai_accounts_set_auto_retry',
      'ai_accounts_set_distribution',
      'ai_accounts_set_native_provider',
      'ai_accounts_snooze_continuation',
    ])
  })

  test('Copilot approval stays GUI-only and cancellation requires an explicit opt-in', async () => {
    const waiting: CopilotLoginState = {
      instanceId: 'copilot',
      status: 'waiting',
      userCode: 'TEST-CODE',
      verificationUri: 'https://github.com/login/device',
      message: 'Approve in the GUI',
    }
    expect(AccountsHostApiModel.copilotForCaller(waiting, { kind: 'client' })).toEqual(waiting)
    for (const caller of [
      { kind: 'agent', sessionId: 'test-agent' },
      { kind: 'plugin', packageId: '@test/plugin' },
    ] as const) {
      expect(AccountsHostApiModel.copilotForCaller(waiting, caller)).toEqual({ ...waiting, userCode: null, verificationUri: null })
    }
    for (const method of [aiAccountsApi.methods.beginCopilotLogin, aiAccountsApi.methods.copilotLoginStatus]) {
      const rendered = method.tool?.render?.(waiting)
      expect(rendered).not.toContain('TEST-CODE')
      expect(rendered).not.toContain('github.com')
    }
    const schema = aiAccountsApi.methods.cancelCopilotLogin.input
    if (schema === undefined) throw new Error('Cancellation must declare its input contract.')
    expect((await schema['~standard'].validate({ instanceId: 'copilot' })).issues).toBeDefined()
    expect((await schema['~standard'].validate({ instanceId: 'copilot', confirm: true })).issues).toBeUndefined()
  })

  test('discard requires explicit consent and raw secret entry has no agent tool', async () => {
    const schema = aiAccountsApi.methods.discardAccountConnection.input
    if (schema === undefined) throw new Error('Discard must have an input schema.')
    const operationId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
    expect((await schema['~standard'].validate({ operationId })).issues).toBeDefined()
    const accepted = await schema['~standard'].validate({ operationId, confirm: true })
    expect(accepted.issues).toBeUndefined()
    if ('value' in accepted) expect(accepted.value.operationId).toBe(operationId.toLowerCase())
    expect(aiAccountsApi.methods.stageAccountConnectionKey.tool).toBeUndefined()
    expect(aiAccountsApi.methods.importAccountConnectionKey.tool?.name).toBe('ai_accounts_import_connection_key')
  })

  test('provisional name editing uses the existing configure tool and its validated input contract', async () => {
    const method = aiAccountsApi.methods.configureAccountConnection
    expect(method.tool?.name).toBe('ai_accounts_configure_connection')
    expect(method.description).toContain('display name for a new account')
    const schema = method.input
    if (schema === undefined) throw new Error('Configuration must declare its input contract.')
    const operationId = '11111111-1111-4111-8111-111111111111'
    const accepted = await schema['~standard'].validate({ operationId, displayName: '  Work  ' })
    expect(accepted.issues).toBeUndefined()
    if ('value' in accepted) expect(accepted.value).toEqual({ operationId, displayName: 'Work' })
    expect((await schema['~standard'].validate({ operationId, displayName: '   ' })).issues).toBeDefined()
  })

  test('pending catalog import fails closed on an old owner before any value is read', () => {
    let reads = 0
    const oldOwner = {
      resolve: async () => {
        reads += 1
        return 'fixture-secret'
      },
    }
    expect(() => AccountsHostApiModel.scopedCatalogValues(oldOwner)).toThrow('updated Secret Catalog Host')
    expect(reads).toBe(0)
    const currentOwner = { ...oldOwner, supportsExpectedScope: true as const }
    expect(AccountsHostApiModel.scopedCatalogValues(currentOwner)).toBe(currentOwner)
    expect(reads).toBe(0)
  })

  test('inspection stays read-only and every tool explains itself', () => {
    const readOnly = Object.values(aiAccountsApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'ai_accounts_catalog',
      'ai_accounts_connection',
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
