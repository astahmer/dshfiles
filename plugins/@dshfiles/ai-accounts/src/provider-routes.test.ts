import { describe, expect, it } from 'vitest'
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
