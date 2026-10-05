import { KIND_ACCENT, KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, type AccountDraft, type AccountProfile } from './api.js'

export const sameDraft = (profile: AccountProfile, draft: AccountDraft): boolean =>
  profile.instanceId === draft.instanceId &&
  profile.kind === draft.kind &&
  profile.displayName === draft.displayName &&
  profile.enabled === draft.enabled &&
  profile.homePath === draft.homePath &&
  profile.shadowHomePath === draft.shadowHomePath &&
  profile.apiKeyEnv === draft.apiKeyEnv &&
  profile.apiBaseUrl === draft.apiBaseUrl &&
  profile.badge === draft.badge &&
  profile.accentColor === draft.accentColor &&
  profile.providerIcon === draft.providerIcon &&
  profile.additionalModelIds.join() === draft.additionalModelIds.join()

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
 * The kind decides every default: a unique route slug, a display name, a tag, a
 * color and a spare icon — all editable after the fact in the numbered sections.
 */
export const newAccountDraft = (input: { readonly kind: AccountProfile['kind']; readonly existing: readonly AccountProfile[] }): AccountDraft => {
  const taken = new Set(input.existing.map(account => account.instanceId))
  let instanceId = `${input.kind}_work`
  for (let suffix = 2; taken.has(instanceId); suffix += 1) instanceId = `${input.kind}_work_${suffix}`
  const displayName = `${KIND_LABEL[input.kind]} ${input.existing.filter(account => account.kind === input.kind).length + 1}`
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
