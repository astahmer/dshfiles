import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as store from './account-store.js'

const accountDraft = {
  instanceId: 'codex-test',
  kind: 'codex',
  displayName: 'Codex Test',
  enabled: true,
  homePath: '/tmp/codex-test-home',
  shadowHomePath: '/tmp/codex-test-shadow',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: 'CT',
  accentColor: '#2563EB',
  providerIcon: 'Bot',
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/**
 * Cordis activates this plugin synchronously and boot reads the store through
 * `readAccountFileSync()`, which answers `emptyFile()` for a cache that was
 * never primed. An unprimed cache therefore registers no routes and the whole
 * Accounts page disappears, which is exactly what happened on a real machine.
 * The store resolves DSH_HOME at import time, so each case stubs the variable
 * and re-imports the module to get a fresh, independently cached instance.
 */
const loadStoreWith = async (accounts: unknown[]): Promise<typeof store> => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-accounts-store-'))
  const dir = join(home, 'plugins', 'ai-accounts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'accounts.json'),
    JSON.stringify({
      distribution: 'sticky',
      cooldownMs: 300000,
      shadowRoot: join(home, 'codex-dshx'),
      accounts,
    }),
  )
  vi.stubEnv('DSH_HOME', home)
  vi.resetModules()
  return import('./account-store.js')
}

describe('account store priming', () => {
  it('serves stored accounts to the first synchronous read', async () => {
    const store = await loadStoreWith([accountDraft])

    const primed = store.primeAccountFile()

    expect(primed.accounts).toHaveLength(1)
    expect(primed.accounts[0]?.instanceId).toBe('codex-test')
  })

  it('keeps the sync read stable across repeats without an async re-read', async () => {
    const store = await loadStoreWith([accountDraft])

    store.primeAccountFile()
    const first = store.readAccountFileSync()
    const second = store.readAccountFileSync()

    expect(first.accounts).toHaveLength(1)
    expect(second.accounts).toEqual(first.accounts)
  })

  it('yields an empty file when the cache was never primed', async () => {
    const store = await loadStoreWith([accountDraft])

    expect(store.readAccountFileSync().accounts).toEqual([])
  })

  it('is what boot depends on: priming before the sync read is the only path that registers routes', async () => {
    const store = await loadStoreWith([accountDraft])

    // This is the boot sequence in host.ts, in order. Without the priming call
    // the sync read yields no accounts, buildRoutes registers nothing, and the
    // panel never mounts.
    const unprimed = store.readAccountFileSync()
    const primed = store.primeAccountFile()

    expect(unprimed.accounts).toHaveLength(0)
    expect(primed.accounts).toHaveLength(1)
  })
})
