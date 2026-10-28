import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { AccountModelSettingsModel } from './account-model-settings.js'
import { accountDraftSchema } from './api.js'

const empty = AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] })
const model = {
  id: 'model',
  name: 'Model',
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}

describe('account model defaults', () => {
  it('keeps empty legacy records inheriting, while legacy authored preferences remain active', () => {
    expect(AccountModelSettingsModel.inheritsModelSettings(empty)).toBe(true)
    expect(AccountModelSettingsModel.inheritsModelSettings({ ...empty, hiddenModelIds: ['model'] })).toBe(false)
    expect(AccountModelSettingsModel.inheritsModelSettings({ ...empty, reasoningDefaults: { model: 'low' } })).toBe(false)
    expect(AccountModelSettingsModel.inheritsModelSettings({ ...empty, defaultReasoningEffort: 'low' })).toBe(false)
  })

  it('suspends without deleting every local model setting and restores them when disabled', () => {
    const local = {
      ...empty,
      reasoningDefaults: { model: 'low' },
      defaultReasoningEffort: 'high',
      hiddenModelIds: ['model'],
      favoriteModelIds: ['other'],
      modelOrder: ['other'],
      additionalModelIds: ['custom'],
    }
    const inherited = { ...local, inheritModelSettings: true }
    expect(AccountModelSettingsModel.effectiveModelSettings(inherited)).toMatchObject({
      reasoningDefaults: {},
      defaultReasoningEffort: null,
      hiddenModelIds: [],
      favoriteModelIds: [],
      modelOrder: [],
      additionalModelIds: [],
    })
    expect(inherited.reasoningDefaults).toEqual({ model: 'low' })
    expect(AccountModelSettingsModel.effectiveModelSettings({ ...inherited, inheritModelSettings: false })).toMatchObject(local)
  })

  it('resolves model override before account default and never pins an unsupported effort', () => {
    expect(AccountModelSettingsModel.effectiveReasoningEffort({ ...empty, defaultReasoningEffort: 'low' }, model)).toBe('low')
    expect(AccountModelSettingsModel.effectiveReasoningEffort({ ...empty, defaultReasoningEffort: 'low', reasoningDefaults: { model: 'high' } }, model)).toBe(
      'high',
    )
    expect(AccountModelSettingsModel.effectiveReasoningEffort({ ...empty, defaultReasoningEffort: 'max' }, model)).toBeNull()
    expect(
      AccountModelSettingsModel.effectiveReasoningEffort({ ...empty, defaultReasoningEffort: 'low', reasoningDefaults: { model: 'unavailable' } }, model),
    ).toBe('low')
    expect(AccountModelSettingsModel.effectiveReasoningEffort({ ...empty, defaultReasoningEffort: 'low', inheritModelSettings: true }, model)).toBeNull()
  })

  it('builds the cross-model option union without fabricated values', () => {
    expect(AccountModelSettingsModel.accountReasoningOptions([model, { ...model, id: 'other', efforts: [{ id: 'low', name: 'Low' }] }])).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ])
  })

  it('round trips optional preferences through the wire schema', () => {
    expect(accountDraftSchema.parse({ ...empty, inheritModelSettings: false, defaultReasoningEffort: 'low' })).toMatchObject({
      inheritModelSettings: false,
      defaultReasoningEffort: 'low',
    })
    const legacy = accountDraftSchema.parse(empty)
    expect(Object.hasOwn(legacy, 'inheritModelSettings')).toBe(false)
    expect(Object.hasOwn(legacy, 'defaultReasoningEffort')).toBe(false)
  })
})
