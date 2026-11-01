import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import {
  AccountsRules,
  accountDraftSchema,
  accountKindSchema,
  createSetupAccountInputSchema,
  configureAccountConnectionInputSchema,
  forecastHistoryBatchInputSchema,
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

const accepts = (patch: Partial<AccountDraft>) => Schema.decodeUnknownResult(accountDraftSchema)({ ...draft, ...patch })._tag === 'Success'

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
    expect(
      Schema.decodeUnknownResult(prepareAccountConnectionInputSchema)({ kind: 'commandcode', requestId: '11111111-1111-4111-8111-111111111111', mode })._tag ===
        'Success',
    ).toBe(true)
  })
})

describe('provisional account display name boundary', () => {
  const operationId = '11111111-1111-4111-8111-111111111111'

  it('accepts optional names, trims them, and reuses the saved account length limit', () => {
    expect(Schema.decodeUnknownSync(configureAccountConnectionInputSchema)({ operationId })).toEqual({ operationId })
    expect(Schema.decodeUnknownSync(configureAccountConnectionInputSchema)({ operationId, displayName: '  Claude work  ' }).displayName).toBe('Claude work')
    const displayName = 'n'.repeat(120)
    expect(Schema.decodeUnknownSync(configureAccountConnectionInputSchema)({ operationId, displayName }).displayName).toBe(
      Schema.decodeUnknownSync(accountDraftSchema.fields.displayName)(displayName),
    )
  })

  it.each(['', '   ', 'n'.repeat(121)])('rejects invalid provisional names', displayName => {
    expect(Schema.decodeUnknownResult(configureAccountConnectionInputSchema)({ operationId, displayName })._tag === 'Success').toBe(false)
  })
})

describe('setup-account creation boundary', () => {
  it.each(accountKindSchema.literals)('accepts %s with a UUID request identity', kind => {
    expect(Schema.decodeUnknownResult(createSetupAccountInputSchema)({ kind, requestId: '11111111-1111-4111-8111-111111111111' })._tag === 'Success').toBe(true)
    expect(`${kind}_work_${'11111111-1111-4111-8111-111111111111'.replaceAll('-', '')}`.length).toBeLessThanOrEqual(64)
  })

  it.each(['', 'not-a-uuid', '../escape', '11111111111141118111111111111111'])('rejects invalid request identity %s', requestId => {
    expect(Schema.decodeUnknownResult(createSetupAccountInputSchema)({ kind: 'codex', requestId })._tag === 'Success').toBe(false)
  })

  it('rejects unsupported provider kinds', () => {
    expect(
      Schema.decodeUnknownResult(createSetupAccountInputSchema)({ kind: '../escape', requestId: '11111111-1111-4111-8111-111111111111' })._tag === 'Success',
    ).toBe(false)
  })
})

describe('forecast history batch boundary', () => {
  it('accepts one or two distinct account ids', () => {
    expect(Schema.decodeUnknownResult(forecastHistoryBatchInputSchema)({ instanceIds: ['work'] })._tag === 'Success').toBe(true)
    expect(Schema.decodeUnknownResult(forecastHistoryBatchInputSchema)({ instanceIds: ['work', 'home'] })._tag === 'Success').toBe(true)
  })

  it.each([{ instanceIds: [] }, { instanceIds: [''] }, { instanceIds: ['work', 'work'] }, { instanceIds: ['a', 'b', 'c'] }, { instanceIds: ['x'.repeat(65)] }])(
    'rejects invalid account batches',
    input => expect(Schema.decodeUnknownResult(forecastHistoryBatchInputSchema)(input)._tag === 'Success').toBe(false),
  )
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
