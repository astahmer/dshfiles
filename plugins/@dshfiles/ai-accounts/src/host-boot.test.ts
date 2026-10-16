import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Boots the sequence host.ts runs against an isolated DSH_HOME, so a regression
 * in the on-disk shape or in priming shows up here rather than as an Accounts
 * page that never mounts — without depending on the developer's own accounts.
 */

const draft = (instanceId: string, kind: string, extra: Record<string, unknown> = {}) => ({
  instanceId,
  kind,
  displayName: instanceId,
  enabled: true,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: '',
  accentColor: '',
  providerIcon: '',
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
  ...extra,
})

let home = ''
const previousHome = process.env.DSH_HOME

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ai-accounts-home-'))
  process.env.DSH_HOME = home
  vi.resetModules()
  await mkdir(join(home, 'plugins', 'ai-accounts'), { recursive: true })
  await writeFile(
    join(home, 'plugins', 'ai-accounts', 'accounts.json'),
    JSON.stringify({
      distribution: 'sticky',
      cooldownMs: 300_000,
      // Codex homes must live under the user's home; resolving the layout touches no disk.
      shadowRoot: '~/.codex-dshx-test',
      accounts: [
        draft('codex', 'codex', { reasoningDefaults: { 'gpt-6-luna': 'low' } }),
        draft('claude_work', 'claude', { homePath: '~/.claude-work' }),
        draft('commandcode_a', 'commandcode'),
        draft('cursor_a', 'cursor'),
      ],
    }),
  )
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
})

describe('host boot against the account store', () => {
  it('routes every kind that serves models and leaves Cursor to its runtime driver', async () => {
    const { primeAccountFile, readAccountFileSync } = await import('./account-store.js')
    const { configFromAccountsFile } = await import('./account-config.js')
    const { ProviderRoutes } = await import('./provider-routes.js')
    primeAccountFile()
    const file = readAccountFileSync()
    expect(file.accounts.find(account => account.instanceId === 'codex')?.reasoningDefaults['gpt-6-luna']).toBe('low')
    const { routes, rejected } = ProviderRoutes.buildRoutes(configFromAccountsFile(file))
    expect(rejected).toEqual([])
    expect([...routes.keys()].sort()).toEqual(['claude_work', 'codex', 'commandcode_a'])
    expect(routes.get('claude_work')?.kind).toBe('claude')
  })

  it('renames an account in place instead of leaving the old slug behind', async () => {
    const { readAccountFile, upsertAccount } = await import('./account-store.js')
    const before = await readAccountFile()
    const original = before.accounts.find(account => account.instanceId === 'commandcode_a')
    expect(original).toBeDefined()
    if (original === undefined) return
    await upsertAccount({ ...original, instanceId: 'commandcode_b' }, 'commandcode_a')
    const after = await readAccountFile()
    expect(after.accounts.map(account => account.instanceId)).toEqual(['codex', 'claude_work', 'commandcode_b', 'cursor_a'])
    await expect(upsertAccount({ ...original, instanceId: 'codex' }, 'commandcode_b')).rejects.toThrow(/already exists/)
  })
})
