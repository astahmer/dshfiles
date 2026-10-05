import { describe, expect, it } from 'vitest'
import { primeAccountFile, readAccountFileSync } from './account-store.js'
import { configFromAccountsFile } from './account-config.js'

/**
 * Boots the same sequence host.ts runs, against the real DSH_HOME store rather
 * than a fixture, so a regression in the on-disk shape or in priming shows up
 * here instead of as an Accounts page that silently never mounts.
 */
describe('host boot against the real account store', () => {
  it('registers a route for every stored account', () => {
    primeAccountFile()
    const config = configFromAccountsFile(readAccountFileSync())

    const routes = [...config.codexAccounts.map(account => account.instanceId), ...config.opencodeAccounts.map(account => account.instanceId)]

    expect(routes.length).toBeGreaterThan(0)
    expect(routes).toContain('codex')
    expect(routes).toContain('codex-alex2')
  })

  it('pins gpt-6-luna to low on every codex account', () => {
    // host.ts reads the pin straight off the store record, the same place the
    // reasoningPins map is built, so the assertion reads the store rather than
    // the derived config: the derived config does not carry pins at all.
    primeAccountFile()

    const codexAccounts = readAccountFileSync().accounts.filter(account => account.kind === 'codex')

    expect(codexAccounts.length).toBeGreaterThan(0)
    for (const account of codexAccounts) {
      expect(account.reasoningDefaults['gpt-6-luna']).toBe('low')
    }
  })
})
