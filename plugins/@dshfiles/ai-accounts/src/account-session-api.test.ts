import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { aiAccountsSessionApi, accountSessionCapabilitySchema } from './account-session-api.js'
import { AccountLocks } from './account-locks.js'
import { AiAccountsSchema } from './effect-schema.js'

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
      AiAccountsSchema.acceptsStrict(accountSessionCapabilitySchema, {
        instanceId: 'work',
        available: true,
        reason: null,
        credentialScope: 'Private account credential',
        token: 'synthetic-forbidden',
      }),
    ).toBe(false)
  })
  it.effect('refuses same-account sign-in/save work while a sign-out awaits I/O, but lets other accounts proceed', () =>
    Effect.gen(function* () {
      const locks = yield* AccountLocks
      const gate = yield* Deferred.make<void>()
      const signOut = yield* Effect.forkChild(locks.withAccounts(['work'], Deferred.await(gate)))
      yield* Effect.yieldNow
      expect(yield* locks.isLocked('work')).toBe(true)
      const refused = yield* Effect.flip(locks.withAccounts(['work'], Effect.succeed('unsafe')))
      expect(refused.message).toContain('already running')
      expect(yield* locks.withAccounts(['other'], Effect.succeed('safe'))).toBe('safe')
      expect(yield* locks.isLocked('work')).toBe(true)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(signOut)
      expect(yield* locks.isLocked('work')).toBe(false)
      expect(yield* locks.withAccounts(['work'], Effect.succeed('next'))).toBe('next')
    }).pipe(Effect.provide(AccountLocks.layer)),
  )
  it.effect('releases every related-account lock on failure and does not steal an existing owner', () =>
    Effect.gen(function* () {
      const locks = yield* AccountLocks
      const failed = yield* Effect.flip(locks.withAccounts(['work', 'related', 'work'], Effect.fail('synthetic failure')))
      expect(failed).toBe('synthetic failure')
      expect(yield* locks.isLocked('work')).toBe(false)
      expect(yield* locks.isLocked('related')).toBe(false)
      const gate = yield* Deferred.make<void>()
      const task = yield* Effect.forkChild(locks.withAccounts(['work'], Deferred.await(gate)))
      yield* Effect.yieldNow
      const refused = yield* Effect.flip(locks.withAccounts(['other', 'work'], Effect.void))
      expect(refused.instanceIds).toEqual(['work'])
      expect(yield* locks.isLocked('other')).toBe(false)
      expect(yield* locks.isLocked('work')).toBe(true)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(task)
    }).pipe(Effect.provide(AccountLocks.layer)),
  )
})
