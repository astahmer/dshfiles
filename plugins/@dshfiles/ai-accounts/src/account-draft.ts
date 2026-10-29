import { z } from 'zod'
import { KIND_ACCENT, KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, accountDraftSchema, type AccountDraft, type AccountKind, type AccountProfile } from './api.js'

export const ROUTE_SLUG_HINT = 'Starts with a letter; letters, digits, dash and underscore. Appears as the provider in the model picker.'

/** What the editor may submit: the wire draft, plus the slug rule the route registry enforces. */
export const accountRouteSlugSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u, ROUTE_SLUG_HINT)

const accountEditorSchema = accountDraftSchema.extend({
  instanceId: accountRouteSlugSchema,
  displayName: z.string().trim().min(1, 'Give the account a display name.').max(120),
})

export class AccountDraftModel {
  /** The first problem that would make the Host refuse this draft, or null when it can be saved. */
  static draftProblem = (draft: AccountDraft): string | null => {
    const result = accountEditorSchema.safeParse(draft)
    return result.success ? null : (result.error.issues[0]?.message ?? 'This account cannot be saved yet.')
  }

  private static defaultHome = {
    codex: '~/.codex',
    claude: '~/.claude',
    'opencode-go': '',
    commandcode: '',
    'github-copilot': '',
    cursor: '',
  } satisfies Record<AccountKind, string>

  /** The authored half of a profile; identity and health are observed, never sent back. */
  static toDraft = (profile: AccountProfile): AccountDraft => ({
    instanceId: profile.instanceId,
    kind: profile.kind,
    displayName: profile.displayName,
    enabled: profile.enabled,
    homePath: profile.homePath,
    shadowHomePath: profile.shadowHomePath,
    apiKeyEnv: profile.apiKeyEnv,
    ...(profile.authSource !== undefined && { authSource: profile.authSource }),
    apiBaseUrl: profile.apiBaseUrl,
    badge: profile.badge,
    accentColor: profile.accentColor,
    providerIcon: profile.providerIcon,
    additionalModelIds: profile.additionalModelIds,
    reasoningDefaults: profile.reasoningDefaults,
    ...(profile.inheritModelSettings !== undefined && { inheritModelSettings: profile.inheritModelSettings }),
    ...(profile.defaultReasoningEffort !== undefined && { defaultReasoningEffort: profile.defaultReasoningEffort }),
    hiddenModelIds: profile.hiddenModelIds,
    favoriteModelIds: profile.favoriteModelIds,
    modelOrder: profile.modelOrder,
  })

  private static sameList = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index])

  private static sameRecord = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
  }

  static sameDraft = (left: AccountDraft, right: AccountDraft): boolean =>
    left.instanceId === right.instanceId &&
    left.kind === right.kind &&
    left.displayName === right.displayName &&
    left.enabled === right.enabled &&
    left.homePath === right.homePath &&
    left.shadowHomePath === right.shadowHomePath &&
    left.apiKeyEnv === right.apiKeyEnv &&
    left.authSource === right.authSource &&
    left.apiBaseUrl === right.apiBaseUrl &&
    left.badge === right.badge &&
    left.accentColor === right.accentColor &&
    left.providerIcon === right.providerIcon &&
    left.inheritModelSettings === right.inheritModelSettings &&
    left.defaultReasoningEffort === right.defaultReasoningEffort &&
    AccountDraftModel.sameList(left.additionalModelIds, right.additionalModelIds) &&
    AccountDraftModel.sameList(left.hiddenModelIds, right.hiddenModelIds) &&
    AccountDraftModel.sameList(left.favoriteModelIds, right.favoriteModelIds) &&
    AccountDraftModel.sameList(left.modelOrder, right.modelOrder) &&
    AccountDraftModel.sameRecord(left.reasoningDefaults, right.reasoningDefaults)

  /**
   * The draft the editor shows after the selection or the store changes; `followedId` is the stored account it last
   * followed. Unsaved edits survive a re-read of that account, a half-typed slug included. While a rename lands, the
   * store and the selection briefly disagree and the selected account is missing: a draft carrying the new slug is kept
   * through that moment, so fields typed meanwhile survive. Any other missing account (a removal) closes the editor.
   */
  static followSelection = (input: {
    readonly current: AccountDraft | null
    readonly selected: AccountProfile | null
    readonly selectedId: string | null
    readonly followedId: string | null
    readonly previousSelected?: AccountProfile | null
  }): AccountDraft | null => {
    if (input.selected === null) {
      const renaming = input.selectedId !== null && input.current !== null && input.current.instanceId !== input.followedId
      return renaming ? input.current : null
    }
    if (input.current === null || AccountDraftModel.sameDraft(input.selected, input.current)) return AccountDraftModel.toDraft(input.selected)
    // Clean editors follow external writes (for example compact setup enabling this account); only local edits need preserving.
    if (input.previousSelected?.instanceId === input.selected.instanceId && AccountDraftModel.sameDraft(input.previousSelected, input.current))
      return AccountDraftModel.toDraft(input.selected)
    if (input.followedId === input.selected.instanceId || input.current.instanceId === input.selected.instanceId) {
      // Availability changed from another surface, not from this editor: retain unrelated typing without restoring the old routing flag.
      if (
        input.previousSelected?.instanceId === input.selected.instanceId &&
        input.current.enabled === input.previousSelected.enabled &&
        input.current.enabled !== input.selected.enabled
      )
        return { ...input.current, enabled: input.selected.enabled }
      return input.current
    }
    return AccountDraftModel.toDraft(input.selected)
  }

  /** Up to three initials, the same tag the reference page derives by default. */
  static badgeFromName = (displayName: string): string =>
    displayName
      .split(/\s+/u)
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0, 3)
      .toUpperCase()

  /**
   * One click, one account. The kind decides every default: a unique route slug,
   * a display name, a tag, a colour and a spare icon — all editable afterwards.
   */
  static suggestedApiKeyRef = (instanceId: string): string => {
    const segment = instanceId.replace(/[^A-Za-z0-9_]/gu, '_').toUpperCase()
    const normalized = /^[A-Z]/u.test(segment) ? segment : `ACCOUNT_${segment}`
    return `${normalized.slice(0, 112)}_API_KEY`
  }

  static newAccountDraft = (input: { readonly kind: AccountKind; readonly existing: readonly AccountDraft[] }): AccountDraft => {
    const taken = new Set(input.existing.map(account => account.instanceId))
    let instanceId = `${input.kind}_work`
    for (let suffix = 2; taken.has(instanceId); suffix += 1) instanceId = `${input.kind}_work_${String(suffix)}`
    const displayName = `${KIND_LABEL[input.kind]} ${String(input.existing.filter(account => account.kind === input.kind).length + 1)}`
    return {
      instanceId,
      kind: input.kind,
      displayName,
      enabled: true,
      homePath: AccountDraftModel.defaultHome[input.kind],
      shadowHomePath: '',
      apiKeyEnv: input.kind === 'codex' || input.kind === 'github-copilot' ? '' : AccountDraftModel.suggestedApiKeyRef(instanceId),
      apiBaseUrl: '',
      badge: AccountDraftModel.badgeFromName(displayName),
      accentColor: KIND_ACCENT[input.kind],
      providerIcon: PROVIDER_ICONS.find(icon => !input.existing.some(account => account.providerIcon === icon)) ?? PROVIDER_ICONS[0],
      additionalModelIds: [],
      reasoningDefaults: {},
      hiddenModelIds: [],
      favoriteModelIds: [],
      modelOrder: [],
    }
  }
}
