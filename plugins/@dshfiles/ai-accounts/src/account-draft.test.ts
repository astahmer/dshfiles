import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { accountProfileSchema, type AccountDraft, type AccountProfile } from './api.js'

describe('account draft defaults', () => {
  it('creates a unique API-key reference for newly added keyed accounts', () => {
    const first = AccountDraftModel.newAccountDraft({ kind: 'opencode-go', existing: [] })
    const second = AccountDraftModel.newAccountDraft({ kind: 'opencode-go', existing: [] })

    expect(first.apiKeyEnv).toBe('OPENCODE_GO_WORK_API_KEY')
    expect(second.apiKeyEnv).toBe(first.apiKeyEnv)
    expect(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }).apiKeyEnv).toBe('')
    const copilot = AccountDraftModel.newAccountDraft({ kind: 'github-copilot', existing: [] })
    expect(copilot.apiKeyEnv).toBe('')
    expect(AccountDraftModel.draftProblem(copilot)).toBeNull()
  })

  it('normalizes reference names to a valid bounded API-key identifier', () => {
    expect(AccountDraftModel.suggestedApiKeyRef('2-company/app')).toBe('ACCOUNT_2_COMPANY_APP_API_KEY')
    expect(AccountDraftModel.suggestedApiKeyRef('a'.repeat(200))).toHaveLength(120)
  })
})

describe('the editor draft following the selection', () => {
  const stored = (draft: AccountDraft): AccountProfile =>
    accountProfileSchema.parse({
      ...draft,
      mode: 'direct',
      signedIn: false,
      identity: null,
      plan: null,
      state: 'healthy',
      loginHint: '',
      detail: null,
    })
  const original = AccountDraftModel.newAccountDraft({ kind: 'commandcode', existing: [] })
  const renamed = { ...original, instanceId: 'fake_route', apiKeyEnv: 'FAKE_ROUTE_API_KEY', apiBaseUrl: 'http://127.0.0.1:4000' }

  it('keeps fields typed while a rename lands, through the moment the selection names no stored account', () => {
    const missing = AccountDraftModel.followSelection({ current: renamed, selected: null, selectedId: 'fake_route', followedId: original.instanceId })
    expect(missing).toBe(renamed)
    const landed = AccountDraftModel.followSelection({
      current: missing,
      selected: stored({ ...original, instanceId: 'fake_route' }),
      selectedId: 'fake_route',
      followedId: original.instanceId,
    })
    expect(landed).toBe(renamed)
  })

  it('keeps a half-typed slug when the store is read again for the same account', () => {
    const typing = { ...original, instanceId: 'fake_ro' }
    expect(
      AccountDraftModel.followSelection({ current: typing, selected: stored(original), selectedId: original.instanceId, followedId: original.instanceId }),
    ).toBe(typing)
  })

  it('keeps the rename through the frame where the store lists the new slug before the selection moves', () => {
    expect(AccountDraftModel.followSelection({ current: renamed, selected: null, selectedId: original.instanceId, followedId: original.instanceId })).toBe(
      renamed,
    )
  })

  it('closes the editor when the followed account is removed, and opens a newly added one', () => {
    const editing = { ...original, displayName: 'Edited' }
    expect(AccountDraftModel.followSelection({ current: editing, selected: null, selectedId: original.instanceId, followedId: original.instanceId })).toBeNull()
    expect(AccountDraftModel.followSelection({ current: renamed, selected: null, selectedId: null, followedId: original.instanceId })).toBeNull()
    const added = AccountDraftModel.newAccountDraft({ kind: 'opencode-go', existing: [] })
    expect(
      AccountDraftModel.followSelection({ current: editing, selected: stored(added), selectedId: added.instanceId, followedId: original.instanceId }),
    ).toEqual(AccountDraftModel.toDraft(stored(added)))
  })
})
