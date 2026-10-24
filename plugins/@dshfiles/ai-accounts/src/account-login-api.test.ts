import { describe, expect, it } from 'vitest'
import { accountLoginMetadata, accountLoginStateSchema, aiAccountsLoginApi, type AccountLoginState } from './account-login-api.js'
import { AccountLoginHostModel } from './account-login-host.js'

const waiting: AccountLoginState = {
  instanceId: 'work',
  status: 'waiting',
  message: 'Enter the code in the Web GUI.',
  errorCode: null,
  verificationUri: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-EFGH',
  expiresAt: 12345,
}

describe('account login typed API and agent exposure', () => {
  it('exposes one shared API with read-only status and user-request-only writes', () => {
    expect(aiAccountsLoginApi.id).toBe('ai-accounts-login')
    expect(aiAccountsLoginApi.owner).toBe('@dshfiles/ai-accounts')
    expect(aiAccountsLoginApi.methods.status.tool?.readOnly).toBe(true)
    for (const method of [aiAccountsLoginApi.methods.begin, aiAccountsLoginApi.methods.cancel]) {
      expect(method.tool?.readOnly).toBe(false)
      expect(method.description).toContain('Call only when the user asked')
    }
  })
  it('requires cancellation consent, accepts only explicit true replacement and rejects caller execution fields', async () => {
    const beginSchema = aiAccountsLoginApi.methods.begin.input
    const cancelSchema = aiAccountsLoginApi.methods.cancel.input
    if (beginSchema === undefined || cancelSchema === undefined) throw new Error('Login methods need explicit input schemas')
    const begin = beginSchema['~standard'].validate
    const cancel = cancelSchema['~standard'].validate
    expect((await begin({ instanceId: 'work' })).issues).toBeUndefined()
    expect((await begin({ instanceId: 'work', replaceExisting: true })).issues).toBeUndefined()
    expect((await begin({ instanceId: 'work', replaceExisting: false })).issues).toBeDefined()
    for (const field of ['command', 'executable', 'args', 'home', 'issuer'])
      expect((await begin({ instanceId: 'work', [field]: 'untrusted' })).issues).toBeDefined()
    expect((await begin({ instanceId: '../escape' })).issues).toBeDefined()
    expect((await cancel({ instanceId: 'work' })).issues).toBeDefined()
    expect((await cancel({ instanceId: 'work', confirm: true })).issues).toBeUndefined()
  })
  it('redacts codes and URLs in raw agent/plugin responses as well as every tool renderer', () => {
    expect(AccountLoginHostModel.forCaller(waiting, { kind: 'client' })).toEqual(waiting)
    const metadata = accountLoginMetadata(waiting)
    expect(metadata).toMatchObject({ userCode: null, verificationUri: null, status: 'waiting' })
    expect(AccountLoginHostModel.forCaller(waiting, { kind: 'agent', sessionId: 'test-agent' })).toEqual(metadata)
    expect(AccountLoginHostModel.forCaller(waiting, { kind: 'plugin', packageId: '@test/plugin' })).toEqual(metadata)
    for (const method of Object.values(aiAccountsLoginApi.methods)) {
      const rendered = method.tool?.render?.(waiting)
      expect(rendered).not.toContain('ABCD-EFGH')
      expect(rendered).not.toContain('auth.openai.com')
    }
    expect(waiting.userCode).toBe('ABCD-EFGH')
  })
  it('does not allow tokens, stdout or arbitrary authentication URLs in public state', () => {
    expect(accountLoginStateSchema.safeParse({ ...waiting, access_token: 'fixture-not-real' }).success).toBe(false)
    expect(accountLoginStateSchema.safeParse({ ...waiting, stdout: 'raw-output' }).success).toBe(false)
    expect(accountLoginStateSchema.safeParse({ ...waiting, verificationUri: 'https://auth.openai.com/codex/device?token=bad' }).success).toBe(false)
    expect(accountLoginStateSchema.safeParse({ ...waiting, userCode: 'long-token' }).success).toBe(false)
  })
})
