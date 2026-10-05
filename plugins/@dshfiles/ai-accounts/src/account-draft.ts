import { z } from 'zod'
import { KIND_ACCENT, KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, accountDraftSchema, type AccountDraft, type AccountKind, type AccountProfile } from './api.js'

export { KIND_ACCENT, KIND_LABEL }

export const ROUTE_SLUG_HINT = 'Letters, digits, dash and underscore. Appears as the provider in the model picker.'

/** What the editor may submit: the wire draft, plus the slug rule the hint promises. */
export const accountEditorSchema = accountDraftSchema.required().extend({
  instanceId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u, ROUTE_SLUG_HINT),
  displayName: z.string().trim().min(1, 'Give the account a display name.').max(120),
})

/** The authored half of a profile; identity and health are observed, never sent back. */
export const toDraft = (profile: AccountProfile): AccountDraft => ({
  instanceId: profile.instanceId,
  kind: profile.kind,
  displayName: profile.displayName,
  enabled: profile.enabled,
  homePath: profile.homePath,
  shadowHomePath: profile.shadowHomePath,
  apiKeyEnv: profile.apiKeyEnv,
  apiBaseUrl: profile.apiBaseUrl,
  badge: profile.badge,
  accentColor: profile.accentColor,
  providerIcon: profile.providerIcon,
  additionalModelIds: profile.additionalModelIds,
  reasoningDefaults: profile.reasoningDefaults,
  hiddenModelIds: profile.hiddenModelIds,
  favoriteModelIds: profile.favoriteModelIds,
  modelOrder: profile.modelOrder,
})

const sameList = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index])

const sameRecord = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
}

export const sameDraft = (left: AccountDraft, right: AccountDraft): boolean =>
  left.instanceId === right.instanceId &&
  left.kind === right.kind &&
  left.displayName === right.displayName &&
  left.enabled === right.enabled &&
  left.homePath === right.homePath &&
  left.shadowHomePath === right.shadowHomePath &&
  left.apiKeyEnv === right.apiKeyEnv &&
  left.apiBaseUrl === right.apiBaseUrl &&
  left.badge === right.badge &&
  left.accentColor === right.accentColor &&
  left.providerIcon === right.providerIcon &&
  sameList(left.additionalModelIds, right.additionalModelIds) &&
  sameList(left.hiddenModelIds, right.hiddenModelIds) &&
  sameList(left.favoriteModelIds, right.favoriteModelIds) &&
  sameList(left.modelOrder, right.modelOrder) &&
  sameRecord(left.reasoningDefaults, right.reasoningDefaults)

/** Up to three initials, the same tag the reference page derives by default. */
export const badgeFromName = (displayName: string): string =>
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
export const newAccountDraft = (input: { readonly kind: AccountKind; readonly existing: readonly AccountProfile[] }): AccountDraft => {
  const taken = new Set(input.existing.map(account => account.instanceId))
  let instanceId = `${input.kind}_work`
  for (let suffix = 2; taken.has(instanceId); suffix += 1) instanceId = `${input.kind}_work_${String(suffix)}`
  const displayName = `${KIND_LABEL[input.kind]} ${String(input.existing.filter(account => account.kind === input.kind).length + 1)}`
  return {
    instanceId,
    kind: input.kind,
    displayName,
    enabled: true,
    homePath: '~/.codex',
    shadowHomePath: '',
    apiKeyEnv: '',
    apiBaseUrl: '',
    badge: badgeFromName(displayName),
    accentColor: KIND_ACCENT[input.kind],
    providerIcon: PROVIDER_ICONS.find(icon => !input.existing.some(account => account.providerIcon === icon)) ?? PROVIDER_ICONS[0],
    additionalModelIds: [],
    reasoningDefaults: {},
    hiddenModelIds: [],
    favoriteModelIds: [],
    modelOrder: [],
  }
}
