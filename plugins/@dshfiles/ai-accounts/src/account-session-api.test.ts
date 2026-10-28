import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { aiAccountsSessionApi, accountSessionCapabilitySchema } from './account-session-api.js'
import { AccountSessionWorkModel } from './account-runtime.js'

const deferred = () => {
  let complete = (): void => {
    throw new Error('not initialized')
  }
  const promise = new Promise<void>(resolve => {
    complete = resolve
  })
  return { promise, complete }
}
describe('sign-out API explicit consent and shared mutation owner', () => {
  it('exposes one owner contract with value-free reads and user-request-only confirmed writes', async () => {
    expect(aiAccountsSessionApi.id).toBe('ai-accounts-session')
    expect(aiAccountsSessionApi.owner).toBe('@dshfiles/ai-accounts')
    expect(aiAccountsSessionApi.methods.capability.tool).toMatchObject({ name: 'ai_accounts_sign_out_capability', readOnly: true })
    const method = aiAccountsSessionApi.methods.signOut
    expect(method.tool).toMatchObject({ name: 'ai_accounts_sign_out', readOnly: false })
    expect(method.description).toContain('Call only when the user asked')
    const schema = method.input
    if (schema === undefined) throw new Error('Missing sign-out input schema')
    const validate = schema['~standard'].validate
    expect((await validate({ instanceId: 'work', confirm: true })).issues).toBeUndefined()
    for (const request of [
      { instanceId: 'work' },
      { instanceId: 'work', confirm: false },
      { instanceId: '../escape', confirm: true },
      { instanceId: 'work', confirm: true, home: '/untrusted' },
      { instanceId: 'work', confirm: true, executable: 'arbitrary-command' },
    ])
      expect((await validate(request)).issues).toBeDefined()
    expect(
      accountSessionCapabilitySchema.safeParse({
        instanceId: 'work',
        available: true,
        reason: null,
        credentialScope: 'Private account credential',
        token: 'synthetic-forbidden',
      }).success,
    ).toBe(false)
  })
  it('refuses same-account sign-in/save work while a sign-out awaits I/O, but lets other accounts proceed', async () => {
    const ctx = new Context()
    const gate = deferred()
    const signOut = AccountSessionWorkModel.run(ctx, ['work'], () => gate.promise)
    expect(AccountSessionWorkModel.isLocked(ctx, 'work')).toBe(true)
    await expect(AccountSessionWorkModel.run(ctx, ['work'], async () => 'unsafe')).rejects.toThrow('already running')
    expect(await AccountSessionWorkModel.run(ctx, ['other'], async () => 'safe')).toBe('safe')
    expect(AccountSessionWorkModel.isLocked(ctx, 'work')).toBe(true)
    gate.complete()
    await signOut
    expect(AccountSessionWorkModel.isLocked(ctx, 'work')).toBe(false)
    expect(await AccountSessionWorkModel.run(ctx, ['work'], async () => 'next')).toBe('next')
  })
  it('releases every related-account lock on failure and does not steal an existing owner', async () => {
    const ctx = new Context()
    await expect(
      AccountSessionWorkModel.run(ctx, ['work', 'related', 'work'], async () => {
        throw new Error('synthetic failure')
      }),
    ).rejects.toThrow('synthetic failure')
    expect(AccountSessionWorkModel.isLocked(ctx, 'work')).toBe(false)
    expect(AccountSessionWorkModel.isLocked(ctx, 'related')).toBe(false)
    const gate = deferred()
    const task = AccountSessionWorkModel.run(ctx, ['work'], () => gate.promise)
    await expect(AccountSessionWorkModel.run(ctx, ['other', 'work'], async () => undefined)).rejects.toThrow()
    expect(AccountSessionWorkModel.isLocked(ctx, 'other')).toBe(false)
    expect(AccountSessionWorkModel.isLocked(ctx, 'work')).toBe(true)
    gate.complete()
    await task
  })
})
