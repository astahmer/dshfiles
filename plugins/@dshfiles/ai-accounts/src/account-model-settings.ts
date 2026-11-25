import type { AccountDraft, AccountsCatalog } from './api.js'

export type AccountModelSettings = Pick<
  AccountDraft,
  'inheritModelSettings' | 'defaultReasoningEffort' | 'reasoningDefaults' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'additionalModelIds'
>

/** One saved override write: the next override record, the value kept for the model, and whether it was lowered. */
export interface ContextWindowWrite {
  readonly overrides: Readonly<Record<string, number>>
  readonly saved: number | null
  readonly clamped: boolean
}

/** The catalog's window fields for one model. */
export interface ContextWindowFields {
  readonly contextWindow?: number
  readonly maxContextWindow?: number
  readonly contextWindowOverride?: number
  readonly effectiveContextWindow?: number
}

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

  /**
   * One override write: `requested` null clears the model's entry; a value above a known maximum is saved as that
   * maximum, so the stored file never claims a window the provider refuses.
   */
  static contextWindowWrite = (input: {
    readonly current: Readonly<Record<string, number>> | undefined
    readonly modelId: string
    readonly requested: number | null
    readonly max: number | undefined
  }): ContextWindowWrite => {
    const { [input.modelId]: _previous, ...rest } = input.current ?? {}
    if (input.requested === null) return { overrides: rest, saved: null, clamped: false }
    const clamped = input.max !== undefined && input.requested > input.max
    const saved = clamped && input.max !== undefined ? input.max : input.requested
    return { overrides: { ...rest, [input.modelId]: saved }, saved, clamped }
  }

  /** The catalog's window fields for one model: default, maximum, saved override and the clamped window in use. */
  static contextWindowFields = (input: {
    readonly contextWindow: number | undefined
    readonly maxContextWindow: number | undefined
    readonly override: number | undefined
  }): ContextWindowFields => {
    const valid = (value: number | undefined): value is number => value !== undefined && Number.isInteger(value) && value >= 1_000 && value <= 10_000_000
    const effective =
      input.override !== undefined
        ? input.maxContextWindow === undefined
          ? input.override
          : Math.min(input.override, input.maxContextWindow)
        : input.contextWindow
    return {
      ...(valid(input.contextWindow) && { contextWindow: input.contextWindow }),
      ...(valid(input.maxContextWindow) && { maxContextWindow: input.maxContextWindow }),
      ...(valid(input.override) && { contextWindowOverride: input.override }),
      ...(valid(effective) && { effectiveContextWindow: effective }),
    }
  }

  /**
   * The windows the editor offers for one model: common sizes between 128k and the provider maximum, plus the default
   * and the maximum themselves. Empty when the provider disclosed no maximum above the default, so nothing can be raised.
   */
  static contextWindowChoices = (input: { readonly contextWindow?: number | undefined; readonly maxContextWindow?: number | undefined }): readonly number[] => {
    const max = input.maxContextWindow
    if (max === undefined) return []
    const base = input.contextWindow ?? max
    if (max <= base) return []
    const steps = [128_000, 200_000, 272_000, 400_000, 500_000, 600_000, 750_000, 1_000_000, 1_500_000, 2_000_000]
    return [...new Set([...steps.filter(step => step < max), base, max])].filter(value => value <= max).sort((left, right) => left - right)
  }

  static effectiveReasoningEffort = (account: AccountModelSettings, model: AccountsCatalog['models'][number]): string | null => {
    const settings = AccountModelSettingsModel.effectiveModelSettings(account)
    const override = settings.reasoningDefaults[model.id]
    const requested = model.efforts.some(effort => effort.id === override) ? override : settings.defaultReasoningEffort
    return requested != null && model.efforts.some(effort => effort.id === requested) ? requested : null
  }
}
