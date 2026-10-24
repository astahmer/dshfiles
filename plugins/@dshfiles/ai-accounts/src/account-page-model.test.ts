import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { filterPageAccounts } from './account-page-model.js'
import { accountProfileSchema, type AccountProfile, type AccountsCatalog } from './api.js'

const account = (instanceId: string, patch: Partial<AccountProfile> = {}): AccountProfile =>
  accountProfileSchema.parse({
    ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
    instanceId,
    displayName: instanceId,
    signedIn: false,
    identity: null,
    plan: null,
    mode: 'direct',
    state: 'unconfigured',
    loginHint: '',
    detail: null,
    ...patch,
  })

const accounts = [
  account('work', { identity: 'person@example.test', plan: 'business' }),
  account('personal', { modelOrder: ['gpt-5'] }),
  account('other', { kind: 'claude' }),
]
const catalog: AccountsCatalog = { instanceId: 'work', models: [{ id: 'gpt-6', name: 'GPT Six', efforts: [], defaultEffort: null }] }

describe('account page search', () => {
  it('keeps full shared priority order and returns the original list for a blank query', () => {
    expect(filterPageAccounts(accounts, '  ', catalog)).toBe(accounts)
    expect(filterPageAccounts(accounts, 'codex', catalog).map(item => item.instanceId)).toEqual(['work', 'personal'])
  })
  it('matches observed provider, identity and plan using all search terms', () => {
    expect(filterPageAccounts(accounts, 'CODEX BUSINESS person@', catalog)).toEqual([accounts[0]])
    expect(filterPageAccounts(accounts, 'claude', catalog)).toEqual([accounts[2]])
    expect(filterPageAccounts(accounts, 'work unknown', catalog)).toEqual([])
  })
  it('searches only stored model IDs and the selected account’s known catalog', () => {
    expect(filterPageAccounts(accounts, 'gpt-5', catalog)).toEqual([accounts[1]])
    expect(filterPageAccounts(accounts, 'gpt six', catalog)).toEqual([accounts[0]])
    expect(filterPageAccounts(accounts, 'gpt six', null)).toEqual([])
    expect(accounts.map(item => item.instanceId)).toEqual(['work', 'personal', 'other'])
  })
})
