import { describe, expect, it } from 'vitest'
import { accountProfileSchema } from './api.js'
import { readAccountUsage } from './account-usage.js'

const copilotAccount = accountProfileSchema.parse({
  instanceId: 'copilot-personal',
  kind: 'github-copilot',
  displayName: 'GitHub Copilot Personal',
  enabled: true,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: 'GH',
  accentColor: '#24292F',
  providerIcon: 'github',
  mode: 'direct',
  signedIn: true,
  identity: null,
  plan: null,
  state: 'healthy',
  loginHint: '',
  detail: null,
})

describe('GitHub Copilot subscription quota', () => {
  it('reports quota as unsupported instead of inventing a usage endpoint', async () => {
    await expect(readAccountUsage({ account: copilotAccount, shadowRoot: '' })).resolves.toMatchObject({
      status: 'unsupported',
      message: 'GitHub does not expose a supported subscription quota endpoint.',
      windows: [],
    })
  })
})
