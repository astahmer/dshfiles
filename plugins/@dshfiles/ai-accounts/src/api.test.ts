import { describe, expect, it } from 'vitest'
import {
  AccountsRules,
  accountDraftSchema,
  accountKindSchema,
  createSetupAccountInputSchema,
  configureAccountConnectionInputSchema,
  prepareAccountConnectionInputSchema,
  type AccountDraft,
} from './api.js'

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

describe('connection method compatibility', () => {
  it.each(['cli', 'reference', 'device'])('preserves explicit %s connection selection on the Host wire', mode => {
    expect(prepareAccountConnectionInputSchema.safeParse({ kind: 'commandcode', requestId: '11111111-1111-4111-8111-111111111111', mode }).success).toBe(true)
  })
})

describe('provisional account display name boundary', () => {
  const operationId = '11111111-1111-4111-8111-111111111111'

  it('accepts optional names, trims them, and reuses the saved account length limit', () => {
    expect(configureAccountConnectionInputSchema.parse({ operationId })).toEqual({ operationId })
    expect(configureAccountConnectionInputSchema.parse({ operationId, displayName: '  Claude work  ' }).displayName).toBe('Claude work')
    const displayName = 'n'.repeat(120)
    expect(configureAccountConnectionInputSchema.parse({ operationId, displayName }).displayName).toBe(accountDraftSchema.shape.displayName.parse(displayName))
  })

  it.each(['', '   ', 'n'.repeat(121)])('rejects invalid provisional names', displayName => {
    expect(configureAccountConnectionInputSchema.safeParse({ operationId, displayName }).success).toBe(false)
  })
})

describe('setup-account creation boundary', () => {
  it.each(accountKindSchema.options)('accepts %s with a UUID request identity', kind => {
    expect(createSetupAccountInputSchema.safeParse({ kind, requestId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true)
    expect(`${kind}_work_${'11111111-1111-4111-8111-111111111111'.replaceAll('-', '')}`.length).toBeLessThanOrEqual(64)
  })

  it.each(['', 'not-a-uuid', '../escape', '11111111111141118111111111111111'])('rejects invalid request identity %s', requestId => {
    expect(createSetupAccountInputSchema.safeParse({ kind: 'codex', requestId }).success).toBe(false)
  })

  it('rejects unsupported provider kinds', () => {
    expect(createSetupAccountInputSchema.safeParse({ kind: '../escape', requestId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
  })
})

describe('account model labels', () => {
  it('identifies the account route in the model picker label', () => {
    expect(AccountsRules.accountModelName('codex-alex2', 'gpt-6-luna')).toBe('codex-alex2/gpt-6-luna')
  })

  it('removes only the matching account prefix for model curation', () => {
    expect(AccountsRules.baseModelName('codex-alex2', 'codex-alex2/gpt-6-luna')).toBe('gpt-6-luna')
    expect(AccountsRules.baseModelName('codex-alex2', 'codex-work/gpt-6-luna')).toBe('codex-work/gpt-6-luna')
    expect(AccountsRules.baseModelName('codex-alex2', 'gpt-6-luna')).toBe('gpt-6-luna')
  })
})
