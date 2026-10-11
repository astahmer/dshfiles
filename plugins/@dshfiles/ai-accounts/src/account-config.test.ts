import { describe, expect, it } from 'vitest'
import { accountDraftSchema } from './api.js'
import { configFromAccountsFile } from './account-config.js'

const account = (kind: 'codex' | 'commandcode' | 'opencode-go' | 'github-copilot') =>
  accountDraftSchema.parse({
    instanceId: `${kind}_test`,
    kind,
    displayName: kind,
    enabled: true,
    homePath: '',
    shadowHomePath: '',
    apiKeyEnv: '',
    apiBaseUrl: '',
    badge: '',
    accentColor: '',
    providerIcon: '',
    additionalModelIds: [],
  })

describe('account route configuration', () => {
  it('routes each provider kind only through its own adapter family', () => {
    const config = configFromAccountsFile({
      accounts: [account('codex'), account('commandcode'), account('opencode-go'), account('github-copilot')],
      distribution: 'sticky',
      cooldownMs: 300000,
      shadowRoot: '',
    })
    expect(config.codexAccounts.map(value => value.instanceId)).toEqual(['codex_test'])
    expect(config.opencodeAccounts.map(value => value.kind)).toEqual(['commandcode', 'opencode-go'])
    expect(config.githubCopilotAccounts.map(value => value.instanceId)).toEqual(['github-copilot_test'])
  })
  it('keeps the original Codex default for an empty file', () => {
    const config = configFromAccountsFile({ accounts: [], distribution: 'sticky', cooldownMs: 300000, shadowRoot: '' })
    expect(config.codexAccounts.map(value => value.instanceId)).toEqual(['codex'])
  })
  it('does not invent a Codex account when only keyed accounts exist', () => {
    const config = configFromAccountsFile({ accounts: [account('commandcode')], distribution: 'sticky', cooldownMs: 300000, shadowRoot: '' })
    expect(config.codexAccounts).toEqual([])
  })
})
