import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { AccountLocks } from './account-locks.js'
import { accountSessionHostApi } from './account-session-host.js'
import { accountLoginHostApi } from './account-login-host.js'
import { accountsHostApi } from './accounts-host-api.js'
import { accountStoreService } from './account-store.js'

const hosts: TestHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose()
  vi.restoreAllMocks()
})
const mount = async (locks: AccountLocks['Service']) => {
  const host = await createTestHost()
  hosts.push(host)
  await host.mount(
    DshxPlugin.make({
      name: 'session-boundary-test',
      layer: Layer.succeed(AccountLocks, locks),
      apis: [accountSessionHostApi, accountLoginHostApi, accountsHostApi],
    }),
    {
      packageId: '@dshfiles/ai-accounts',
    },
  )
  return host
}
const call = async (host: TestHost, apiId: string, method: string, input: unknown) => {
  const response = await host.connection.requestApi({ packageId: '@dshfiles/ai-accounts', apiId, method, version: 1, input })
  return response.text()
}
describe('native Host session contract and mutation guards', () => {
  it('registers the new capability and rejects an unconfirmed write before any account or credential access', async () => {
    const host = await mount(await Effect.runPromise(AccountLocks.make))
    const read = vi.spyOn(accountStoreService, 'readAccountFile')
    const text = await call(host, 'ai-accounts-session', 'signOut', { instanceId: 'synthetic' })
    expect(text).not.toContain('"signedOut":true')
    expect(text).toContain('error')
    expect(read).not.toHaveBeenCalled()
  })
  it('shares the real async lock with sign-out, Codex/Copilot sign-in, saved key imports and saved profile removal', async () => {
    const locks = await Effect.runPromise(AccountLocks.make)
    const host = await mount(locks)
    const gate = Effect.runSync(Deferred.make<void>())
    const owned = Effect.runFork(locks.withAccounts(['synthetic'], Deferred.await(gate)))
    await Effect.runPromise(Effect.yieldNow)
    const read = vi.spyOn(accountStoreService, 'readAccountFile')
    try {
      const capability = await call(host, 'ai-accounts-session', 'capability', { instanceId: 'synthetic' })
      expect(capability).toContain('"available":false')
      for (const [apiId, method, input] of [
        ['ai-accounts-session', 'signOut', { instanceId: 'synthetic', confirm: true }],
        ['ai-accounts-login', 'begin', { instanceId: 'synthetic' }],
        ['ai-accounts', 'beginCopilotLogin', { instanceId: 'synthetic' }],
        ['ai-accounts', 'remove', { instanceId: 'synthetic' }],
        ['ai-accounts', 'prepareAccountConnection', { kind: 'codex', existingInstanceId: 'synthetic', requestId: '11111111-1111-4111-8111-111111111111' }],
        ['ai-accounts', 'importSecretCatalogKey', { instanceId: 'synthetic', alias: 'fake', environment: 'prod', scope: 'global', cwd: null }],
      ] as const) {
        const text = await call(host, apiId, method, input)
        expect(text).toContain('"code":"account-busy"')
      }
      expect(read).not.toHaveBeenCalled()
    } finally {
      await Effect.runPromise(Deferred.succeed(gate, undefined).pipe(Effect.andThen(Fiber.join(owned))))
    }
  })
})
