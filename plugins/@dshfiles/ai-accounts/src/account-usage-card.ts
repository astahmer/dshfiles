import type { AccountDraft, AccountsUsage, UsageCard } from './api.js'
import { AccountProfilesModel } from './account-store.js'

/**
 * One quota card for one account. The provider's reading and DSH's extra-usage gate travel together so a card can never
 * be read as if the provider's own setting were the switch: an account whose provider keeps reporting extra usage on is
 * still refusing it while `useExtraUsage` is false.
 */
export const accountUsageCard = (input: { readonly account: AccountDraft; readonly usage: UsageCard }): AccountsUsage['cards'][number] => ({
  instanceId: input.account.instanceId,
  displayName: AccountProfilesModel.displayNameOf(input.account),
  kind: input.account.kind,
  enabled: input.account.enabled,
  useExtraUsage: input.account.useExtraUsage === true,
  usage: input.usage,
})
