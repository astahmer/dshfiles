import type { AccountDraft, AccountsCatalog } from './api.js'

export type AccountModelSettings = Pick<
  AccountDraft,
  'inheritModelSettings' | 'defaultReasoningEffort' | 'reasoningDefaults' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'additionalModelIds'
>

export class AccountModelSettingsModel {
  /** Legacy authored preferences stay active; an untouched legacy account follows its native provider. */
  static inheritsModelSettings = (account: AccountModelSettings): boolean =>
    account.inheritModelSettings ??
    (account.defaultReasoningEffort == null &&
      Object.keys(account.reasoningDefaults).length === 0 &&
      account.hiddenModelIds.length === 0 &&
      account.favoriteModelIds.length === 0 &&
      account.modelOrder.length === 0 &&
      account.additionalModelIds.length === 0)

  /** These are native provider settings, never another account's preferences. Local data remains stored while suspended. */
  static effectiveModelSettings = (account: AccountModelSettings): AccountModelSettings =>
    AccountModelSettingsModel.inheritsModelSettings(account)
      ? {
          inheritModelSettings: true,
          defaultReasoningEffort: null,
          reasoningDefaults: {},
          hiddenModelIds: [],
          favoriteModelIds: [],
          modelOrder: [],
          additionalModelIds: [],
        }
      : account

  static accountReasoningOptions = (catalog: readonly AccountsCatalog['models'][number][]): { value: string; label: string }[] => [
    ...new Map(catalog.flatMap(model => model.efforts.map(effort => [effort.id, { value: effort.id, label: effort.name }] as const))).values(),
  ]

  static effectiveReasoningEffort = (account: AccountModelSettings, model: AccountsCatalog['models'][number]): string | null => {
    const settings = AccountModelSettingsModel.effectiveModelSettings(account)
    const override = settings.reasoningDefaults[model.id]
    const requested = model.efforts.some(effort => effort.id === override) ? override : settings.defaultReasoningEffort
    return requested != null && model.efforts.some(effort => effort.id === requested) ? requested : null
  }
}
