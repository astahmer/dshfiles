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

    const primed = store.accountStoreService.primeAccountFile()

    expect(primed.accounts).toHaveLength(1)
    expect(primed.accounts[0]?.instanceId).toBe('codex-test')
    expect(store.AccountStoreModel.filePath()).toMatch(/\/plugins\/ai-accounts\/accounts\.json$/u)
  })

  it('keeps the sync read stable across repeats without an async re-read', async () => {
    const store = await loadStoreWith([accountDraft])

    store.accountStoreService.primeAccountFile()
    const first = store.accountStoreService.readAccountFileSync()
    const second = store.accountStoreService.readAccountFileSync()

    expect(first.accounts).toHaveLength(1)
    expect(second.accounts).toEqual(first.accounts)
  })

  it('yields an empty file when the cache was never primed', async () => {
    const store = await loadStoreWith([accountDraft])

    expect(store.accountStoreService.readAccountFileSync().accounts).toEqual([])
  })

  it('is what boot depends on: priming before the sync read is the only path that registers routes', async () => {
    const store = await loadStoreWith([accountDraft])

    // This is the boot sequence in host.ts, in order. Without the priming call
    // the sync read yields no accounts, buildRoutes registers nothing, and the
    // panel never mounts.
    const unprimed = store.accountStoreService.readAccountFileSync()
    const primed = store.accountStoreService.primeAccountFile()

    expect(unprimed.accounts).toHaveLength(0)
    expect(primed.accounts).toHaveLength(1)
  })

  it('moves an account within its provider order without changing other accounts', async () => {
    const claude = { ...accountDraft, instanceId: 'claude-work', kind: 'claude', displayName: 'Claude Work', homePath: '~/.claude-work' }
    const secondCodex = { ...accountDraft, instanceId: 'codex-second', displayName: 'Codex Second' }
    const store = await loadStoreWith([accountDraft, claude, secondCodex])

    const moved = await store.accountStoreService.moveAccount('codex-test', 'later')

    expect(moved.accounts.map(account => account.instanceId)).toEqual(['codex-second', 'claude-work', 'codex-test'])
    expect(moved.accounts.filter(account => account.kind === 'codex').map(account => account.instanceId)).toEqual(['codex-second', 'codex-test'])
    expect(store.accountStoreService.readAccountFileSync().accounts).toEqual(moved.accounts)
  })

  it('serializes overlapping move, save, distribution and remove without lost updates', async () => {
    const first = { ...accountDraft, kind: 'github-copilot' as const }
    const second = { ...first, instanceId: 'second' }
    const removed = { ...first, instanceId: 'removed' }
    const store = await loadStoreWith([first, second, removed])
    await Promise.all([
      store.accountStoreService.moveAccount('second', 'earlier'),
      store.accountStoreService.upsertAccount({ ...first, displayName: 'Edited concurrently' }),
      store.accountStoreService.setDistribution('priority'),
      store.accountStoreService.removeAccount('removed'),
    ])
    const file = await store.accountStoreService.readAccountFile()
    expect(file.accounts.map(account => account.instanceId)).toEqual(['second', 'codex-test'])
    expect(file.accounts[1]?.displayName).toBe('Edited concurrently')
    expect(file.distribution).toBe('priority')
  })

  it('accepts the next mutation after a rejected account rename', async () => {
    const first = { ...accountDraft, kind: 'github-copilot' as const }
    const second = { ...first, instanceId: 'second' }
    const store = await loadStoreWith([first, second])
    const outcomes = await Promise.allSettled([
      store.accountStoreService.upsertAccount(second, first.instanceId),
      store.accountStoreService.setDistribution('priority'),
    ])
    expect(outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'fulfilled'])
    expect((await store.accountStoreService.readAccountFile()).accounts.map(account => account.instanceId)).toEqual(['codex-test', 'second'])
    expect(store.accountStoreService.readAccountFileSync().distribution).toBe('priority')
  })

  it('persists a target reorder and refreshes the synchronous canonical store cache', async () => {
    const store = await loadStoreWith([accountDraft, { ...accountDraft, instanceId: 'disabled', enabled: false }, { ...accountDraft, instanceId: 'last' }])
    const moved = await store.accountStoreService.reorderAccount({ instanceId: 'last', targetInstanceId: 'codex-test', placement: 'before' })
    expect(moved.accounts.map(account => account.instanceId)).toEqual(['last', 'codex-test', 'disabled'])
    // Check before any async read can repair a stale sync cache.
    expect(store.accountStoreService.readAccountFileSync().accounts).toEqual(moved.accounts)
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual(moved.accounts)

    const { configFromAccountsFile } = await import('./account-config.js')
    const { createAccountPool } = await import('./account-pool.js')
    const pool = createAccountPool({ distribution: 'priority' })
    pool.replace(
      configFromAccountsFile(moved).codexAccounts.map(account => ({
        id: account.instanceId,
        kind: 'codex',
        label: account.displayName,
        enabled: account.enabled,
      })),
    )
    expect(pool.acquire({ candidateIds: ['codex-test', 'disabled', 'last'] })?.id).toBe('last')
  })

  it('serializes overlapping reorder, save, distribution and remove without lost updates', async () => {
    const first = { ...accountDraft, kind: 'github-copilot' as const }
    const second = { ...first, instanceId: 'second' }
    const removed = { ...first, instanceId: 'removed' }
    const store = await loadStoreWith([first, second, removed])
    await Promise.all([
      store.accountStoreService.reorderAccount({ instanceId: 'second', targetInstanceId: 'codex-test', placement: 'before' }),
      store.accountStoreService.upsertAccount({ ...first, displayName: 'Edited concurrently' }),
      store.accountStoreService.setDistribution('priority'),
      store.accountStoreService.removeAccount('removed'),
    ])
    const file = await store.accountStoreService.readAccountFile()
    expect(file.accounts.map(account => account.instanceId)).toEqual(['second', 'codex-test'])
    expect(file.accounts[1]?.displayName).toBe('Edited concurrently')
    expect(file.distribution).toBe('priority')
  })

  it('rejects stale targets/orders, then accepts the next write after a rejection', async () => {
    const store = await loadStoreWith([accountDraft, { ...accountDraft, instanceId: 'second' }])
    const input = { instanceId: 'second', targetInstanceId: 'codex-test', placement: 'before' as const, expectedOrder: ['codex-test', 'second'] }
    const outcomes = await Promise.allSettled([store.accountStoreService.reorderAccount(input), store.accountStoreService.reorderAccount(input)])
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'rejected'])
    await expect(store.accountStoreService.reorderAccount({ instanceId: 'second', targetInstanceId: 'gone', placement: 'before' })).rejects.toThrow(
      /no longer available/,
    )
    await store.accountStoreService.moveAccount('second', 'later')
    expect((await store.accountStoreService.readAccountFile()).accounts.map(account => account.instanceId)).toEqual(['codex-test', 'second'])
  })
})
