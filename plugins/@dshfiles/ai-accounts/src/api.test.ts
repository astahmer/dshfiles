import { describe, expect, it } from 'vitest'
import { accountDraftSchema, accountModelName, baseModelName, type AccountDraft } from './api.js'

const draft: AccountDraft = {
  instanceId: 'commandcode_work',
  kind: 'commandcode',
  displayName: 'Work',
  enabled: true,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: 'COMMANDCODE_API_KEY',
  apiBaseUrl: 'https://api.commandcode.ai',
  badge: '',
  accentColor: '',
  providerIcon: 'Bot',
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
}

const accepts = (patch: Partial<AccountDraft>) => accountDraftSchema.safeParse({ ...draft, ...patch }).success

describe('account draft boundary', () => {
  it('accepts a keyed account on the Command Code host', () => {
    expect(accepts({})).toBe(true)
    expect(accepts({ apiKeyEnv: '', apiBaseUrl: '' })).toBe(true)
    expect(accepts({ apiBaseUrl: 'http://localhost:8787' })).toBe(true)
  })

  it.each(['AWS_SECRET_ACCESS_KEY', 'HOME', 'PATH', 'commandcode_api_key', 'X_API_KEY_SUFFIX'])('refuses %s as a key variable', apiKeyEnv =>
    expect(accepts({ apiKeyEnv })).toBe(false),
  )

  it.each([
    'https://attacker.example',
    'http://api.commandcode.ai',
    'https://commandcode.ai.attacker.example',
    'https://user:pass@api.commandcode.ai',
    'not a url',
  ])('refuses %s as a base URL', apiBaseUrl => expect(accepts({ apiBaseUrl })).toBe(false))

  it.each(['relative/home', '~/../etc', '/Users/me/../../etc', '~/.codex/\0'])('refuses %s as a home path', homePath =>
    expect(accepts({ homePath })).toBe(false),
  )
})

describe('account model labels', () => {
  it('identifies the account route in the model picker label', () => {
    expect(accountModelName('codex-alex2', 'gpt-6-luna')).toBe('codex-alex2/gpt-6-luna')
  })

  it('removes only the matching account prefix for model curation', () => {
    expect(baseModelName('codex-alex2', 'codex-alex2/gpt-6-luna')).toBe('gpt-6-luna')
    expect(baseModelName('codex-alex2', 'codex-work/gpt-6-luna')).toBe('codex-work/gpt-6-luna')
    expect(baseModelName('codex-alex2', 'gpt-6-luna')).toBe('gpt-6-luna')
  })
})
