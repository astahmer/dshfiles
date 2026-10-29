import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
const loadStoreWith = async (accounts: unknown[]) => {
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
  const storeModule = await import('./account-store.js')
  const { AccountHomePolicy } = await import('./account-home-policy.js')
  return { ...storeModule, AccountHomePolicy }
}

describe('account store priming', () => {
  it('serves stored accounts to the first synchronous read', async () => {
    const store = await loadStoreWith([accountDraft])

    const primed = store.accountStoreService.primeAccountFile()

    expect(primed.accounts).toHaveLength(1)
    expect(primed.accounts[0]?.instanceId).toBe('codex-test')
    expect(store.AccountHomePolicy.filePath()).toMatch(/\/plugins\/ai-accounts\/accounts\.json$/u)
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
  })

  it('persists a target reorder and refreshes the synchronous canonical store cache', async () => {
    const store = await loadStoreWith([accountDraft, { ...accountDraft, instanceId: 'disabled', enabled: false }, { ...accountDraft, instanceId: 'last' }])
    const moved = await store.accountStoreService.reorderAccount({ instanceId: 'last', targetInstanceId: 'codex-test', placement: 'before' })
    expect(moved.accounts.map(account => account.instanceId)).toEqual(['last', 'codex-test', 'disabled'])
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual(moved.accounts)
    expect(store.accountStoreService.readAccountFileSync().accounts).toEqual(moved.accounts)
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

const requestOne = '11111111-1111-4111-8111-111111111111'
const requestTwo = '22222222-2222-4222-8222-222222222222'
const requestThree = '33333333-3333-4333-8333-333333333333'

describe('atomic setup account creation', () => {
  it('does not publish an unconnected setup candidate to the saved store', async () => {
    const store = await loadStoreWith([])
    await store.accountStoreService.createSetupAccount({ kind: 'codex', requestId: requestOne })
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual([])
  })
  it('creates distinct accounts from stale concurrent requests, using the latest same-provider count and preserving existing profiles', async () => {
    const existing = { ...accountDraft, kind: 'github-copilot', instanceId: 'github-copilot_work', enabled: false, displayName: 'Keep my account' }
    const store = await loadStoreWith([existing])
    const [first, second, retry] = await Promise.all([
      store.accountStoreService.createSetupAccount({ kind: 'github-copilot', requestId: requestOne }),
      store.accountStoreService.createSetupAccount({ kind: 'github-copilot', requestId: requestTwo }),
      store.accountStoreService.createSetupAccount({ kind: 'github-copilot', requestId: requestOne }),
    ])
    expect(first.instanceId).toBe('github-copilot_work_11111111111141118111111111111111')
    expect(second.instanceId).not.toBe(first.instanceId)
    expect(retry.instanceId).toBe(first.instanceId)
    const file = await store.accountStoreService.readAccountFile()
    expect(file.accounts).toEqual([existing])
    expect(first.draft.displayName).toMatch(/ 2$/u)
    expect(second.draft.displayName).toMatch(/ 2$/u)
    expect(first.file.accounts).toEqual([existing])
  })

  it('keeps every newly allocated setup profile disabled until connecting finishes', async () => {
    const store = await loadStoreWith([])
    for (const kind of ['codex', 'claude', 'github-copilot', 'opencode-go', 'commandcode', 'cursor'] as const) {
      const created = await store.accountStoreService.createSetupAccount({ kind, requestId: requestOne })
      expect(created.draft).toMatchObject({ kind, enabled: false })
      expect(created.file.accounts).toEqual([])
    }
  })

  it('refuses candidate allocation for a saved identity without overwriting it', async () => {
    const store = await loadStoreWith([])
    const input = { kind: 'github-copilot' as const, requestId: requestOne }
    const created = await store.accountStoreService.createSetupAccount(input)
    const original = created.draft
    if (original === undefined) throw new Error('Expected newly created account')
    const edited = { ...original, displayName: 'My edited name', enabled: true, badge: 'EDIT', hiddenModelIds: ['keep-model'] }
    await store.accountStoreService.upsertAccount(edited)
    await expect(store.accountStoreService.createSetupAccount(input)).rejects.toThrow('already saved')
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual([edited])
  })

  it('gives Codex and Claude unique owned homes in scratch storage without creating or seeding auth', async () => {
    const store = await loadStoreWith([])
    const [codex, secondCodex, claude] = await Promise.all([
      store.accountStoreService.createSetupAccount({ kind: 'codex', requestId: requestOne }),
      store.accountStoreService.createSetupAccount({ kind: 'codex', requestId: requestTwo }),
      store.accountStoreService.createSetupAccount({ kind: 'claude', requestId: requestThree }),
    ])
    const root = join(store.AccountHomePolicy.filePath(), '..', 'homes')
    const final = await store.accountStoreService.readAccountFile()
    expect(final.accounts).toEqual([])
    const first = codex.draft
    const second = secondCodex.draft
    const third = claude.draft
    if (first === undefined || second === undefined || third === undefined) throw new Error('Expected all setup accounts')
    expect(first.homePath).toBe(join(root, first.instanceId))
    expect(first.shadowHomePath).toBe(first.homePath)
    expect(second.homePath).not.toBe(first.homePath)
    expect(second.shadowHomePath).toBe(second.homePath)
    expect(third.homePath).toBe(join(root, third.instanceId))
    expect(third.shadowHomePath).toBe('')
    expect(store.AccountHomePolicy.isManagedSetupHome(first.homePath, 'codex')).toBe(true)
    expect(store.AccountHomePolicy.isManagedSetupHome(third.homePath, 'claude')).toBe(true)
    expect(store.AccountHomePolicy.isManagedSetupHome(first.homePath, 'claude')).toBe(false)
    expect(store.AccountHomePolicy.codexLayoutFor(first, final.shadowRoot)).toEqual({
      mode: 'direct',
      sharedHomePath: first.homePath,
      effectiveHomePath: first.homePath,
    })
    expect(await store.accountStoreService.readAccountIdentity(first.instanceId)).toMatchObject({ signedIn: false })
    expect(existsSync(first.homePath)).toBe(false)
    expect(existsSync(join(first.homePath, 'auth.json'))).toBe(false)
    expect(existsSync(third.homePath)).toBe(false)
  })

  it('regenerates keyed references from final IDs and normalizes UUID case for idempotent retry', async () => {
    const store = await loadStoreWith([])
    const requestId = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    const created = await store.accountStoreService.createSetupAccount({ kind: 'commandcode', requestId })
    expect(created.draft.apiKeyEnv).toBe(`${created.instanceId.replaceAll('-', '_').toUpperCase()}_API_KEY`)
    const retried = await store.accountStoreService.createSetupAccount({ kind: 'commandcode', requestId: requestId.toUpperCase() })
    expect(retried.instanceId).toBe(created.instanceId)
    expect(retried.file.accounts).toHaveLength(0)
  })

  it('publishes only after the final fence and never recreates a removed existing account', async () => {
    const store = await loadStoreWith([])
    const candidate = await store.accountStoreService.createSetupAccount({ kind: 'opencode-go', requestId: requestOne })
    const rejected = { draft: candidate.draft, existing: undefined, claimCommit: () => false, didCommit: () => undefined }
    await expect(store.accountStoreService.commitConnection(rejected)).rejects.toThrow('no longer active')
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual([])
    await store.accountStoreService.commitConnection({ ...rejected, claimCommit: () => true })
    const saved = (await store.accountStoreService.readAccountFile()).accounts[0]
    expect(saved?.enabled).toBe(true)
    await store.accountStoreService.removeAccount(candidate.instanceId)
    await expect(store.accountStoreService.commitConnection({ ...rejected, existing: saved, claimCommit: () => true })).rejects.toThrow('removed')
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual([])
  })

  it('refuses the normal settings-save path for an unsaved or removed account', async () => {
    const store = await loadStoreWith([])
    const candidate = await store.accountStoreService.createSetupAccount({ kind: 'cursor', requestId: requestOne })
    await expect(store.accountStoreService.upsertAccount(candidate.draft, undefined, true)).rejects.toThrow('Connect a new account')
    expect((await store.accountStoreService.readAccountFile()).accounts).toEqual([])
  })

  it('only recognizes canonical generated setup homes in the trusted active store root', async () => {
    const store = await loadStoreWith([])
    const root = join(store.AccountHomePolicy.filePath(), '..', 'homes')
    const instanceId = `codex_work_${requestOne.replaceAll('-', '')}`
    const valid = join(root, instanceId)
    expect(store.AccountHomePolicy.isManagedSetupHome(valid, 'codex')).toBe(true)
    for (const path of [
      '',
      root,
      `${root}/`,
      `${valid}/`,
      `${root}//${instanceId}`,
      `${root}/../homes/${instanceId}`,
      `${root}/child/../${instanceId}`,
      `${valid}/child`,
      join(root, 'manual'),
      `/tmp/${instanceId}`,
      instanceId,
    ]) {
      expect(store.AccountHomePolicy.isManagedSetupHome(path, 'codex')).toBe(false)
    }
  })

  it('does not let traversal ids or near-match manual paths bypass Codex home containment', async () => {
    const store = await loadStoreWith([])
    const root = join(store.AccountHomePolicy.filePath(), '..', 'homes')
    for (const instanceId of ['', '..', '../escape', '../../escape', '/tmp/escape']) {
      const path = join(root, instanceId)
      expect(() => store.AccountHomePolicy.codexLayoutFor({ instanceId, homePath: path, shadowHomePath: path }, '/tmp/unused')).toThrow()
    }
    const instanceId = `codex_work_${requestOne.replaceAll('-', '')}`
    const path = join(root, instanceId, 'near-match')
    expect(() => store.AccountHomePolicy.codexLayoutFor({ instanceId, homePath: path, shadowHomePath: path }, '/tmp/unused')).toThrow()
  })
})
