import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import type { AiAccountsConfig } from './account-config.js'
import { COMMANDCODE_KIND, ProviderRoutes, type KeyedRoute } from './provider-routes.js'

const route = (apiKeyEnv: string): KeyedRoute => ({
  kind: COMMANDCODE_KIND,
  instanceId: 'commandcode-work',
  displayName: 'Command Code Work',
  apiKeyEnv,
  apiBaseUrl: '',
  enabled: true,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('managed setup Codex routes', () => {
  it('builds the enabled route directly in the private scratch home created by the Host', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-managed-route-'))
    vi.stubEnv('DSH_HOME', home)
    vi.resetModules()
    const { accountStoreService, AccountStoreModel } = await import('./account-store.js')
    const { configFromAccountsFile } = await import('./account-config.js')
    const { ProviderRoutes } = await import('./provider-routes.js')
    const { CodexHomeModel } = await import('./codex-home.js')
    const created = await accountStoreService.createSetupAccount({ kind: 'codex', requestId: '11111111-1111-4111-8111-111111111111' })
    const expectedHome = join(home, 'plugins', 'ai-accounts', 'homes', created.instanceId)
    const draft = created.file.accounts[0]
    if (draft === undefined) throw new Error('Expected setup Codex draft')
    expect(draft.enabled).toBe(false)
    const enabled = await accountStoreService.upsertAccount({ ...draft, enabled: true })
    const config = configFromAccountsFile(enabled)
    const account = config.codexAccounts[0]
    if (account === undefined) throw new Error('Expected setup Codex config')
    const built = ProviderRoutes.buildRoutes(config)
    expect(built.rejected).toEqual([])
    expect([...built.routes.keys()]).toEqual([created.instanceId])
    expect(built.routes.get(created.instanceId)).toMatchObject({
      kind: 'codex',
      enabled: true,
      layout: { mode: 'direct', sharedHomePath: expectedHome, effectiveHomePath: expectedHome },
    })
    expect(built.routes.get(created.instanceId)).toMatchObject({ layout: AccountStoreModel.codexLayoutFor(account, config.codexShadowRoot) })
    // The exception belongs to the managed policy, not a relaxation of the raw/global Codex guard.
    expect(() => CodexHomeModel.resolveLayout({ homePath: expectedHome, shadowHomePath: expectedHome })).toThrow()
  })

  it('still rejects a near-match path, a mismatched account id, or a noncanonical configured path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-managed-route-'))
    vi.stubEnv('DSH_HOME', home)
    vi.resetModules()
    const { accountStoreService } = await import('./account-store.js')
    const { configFromAccountsFile } = await import('./account-config.js')
    const { ProviderRoutes } = await import('./provider-routes.js')
    const created = await accountStoreService.createSetupAccount({ kind: 'codex', requestId: '11111111-1111-4111-8111-111111111111' })
    const config = configFromAccountsFile(created.file)
    const account = config.codexAccounts[0]
    if (account === undefined) throw new Error('Expected setup Codex config')
    for (const invalid of [
      { ...account, homePath: `${account.homePath}/near-match`, shadowHomePath: `${account.homePath}/near-match` },
      { ...account, instanceId: 'codex_manual' },
      { ...account, homePath: `${account.homePath}/../${created.instanceId}`, shadowHomePath: `${account.homePath}/../${created.instanceId}` },
    ]) {
      const built = ProviderRoutes.buildRoutes({ ...config, codexAccounts: [invalid] })
      expect(built.routes.size).toBe(0)
      expect(built.rejected).toHaveLength(1)
    }
  })
})

describe('keyed route credentials', () => {
  it('uses Command Code default key when account does not name one', () => {
    expect(ProviderRoutes.keyEnvFor(route(''))).toBe(DEFAULT_COMMANDCODE_KEY_ENV)
  })

  it('trims the key variable named by an account', () => {
    expect(ProviderRoutes.keyEnvFor(route(' CUSTOM_API_KEY '))).toBe('CUSTOM_API_KEY')
  })
})

describe('provider ids another plugin serves', () => {
  const config = (enabled: boolean): AiAccountsConfig => ({
    codexAccounts: [],
    opencodeAccounts: [
      { instanceId: 'commandcode', displayName: '', kind: COMMANDCODE_KIND, apiKeyEnv: '', apiBaseUrl: '', enabled },
      { instanceId: 'opencode-go-work', displayName: '', kind: 'opencode-go', apiKeyEnv: '', apiBaseUrl: '', enabled: true },
    ],
    claudeAccounts: [],
    githubCopilotAccounts: [{ instanceId: 'copilot-work', displayName: 'Copilot Work', enabled }],
    opencodeApiKey: '',
    distribution: 'sticky',
    cooldownMs: 0,
    codexShadowRoot: '',
  })

  it('leaves out an enabled account whose id is already registered, and says why', () => {
    const { routes, rejected } = ProviderRoutes.buildRoutes(config(true), { takenProviders: new Set(['commandcode']) })
    expect([...routes.keys()]).toEqual(['opencode-go-work', 'copilot-work'])
    expect(routes.get('copilot-work')).toMatchObject({ kind: 'github-copilot', displayName: 'Copilot Work' })
    expect(rejected).toEqual(['commandcode: another plugin already serves provider "commandcode"'])
  })

  it('keeps a disabled account, which registers no adapter', () => {
    const { routes, rejected } = ProviderRoutes.buildRoutes(config(false), { takenProviders: new Set(['commandcode']) })
    expect([...routes.keys()].sort()).toEqual(['commandcode', 'copilot-work', 'opencode-go-work'])
    expect(rejected).toEqual([])
  })
})
