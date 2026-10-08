import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { COMMANDCODE_KIND, keyEnvFor, type KeyedRoute } from './provider-routes.js'

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
    expect(keyEnvFor(route(''))).toBe(DEFAULT_COMMANDCODE_KEY_ENV)
  })

  it('trims the key variable named by an account', () => {
    expect(keyEnvFor(route(' CUSTOM_API_KEY '))).toBe('CUSTOM_API_KEY')
  })
})
