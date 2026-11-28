import { KIND_LABEL } from './account-labels.js'
import type { AccountProfile, AccountsCatalog } from './api.js'

/** Search only observed account metadata and known model IDs; never change priority order. */
export const filterPageAccounts = (accounts: readonly AccountProfile[], query: string, catalog: AccountsCatalog | null): readonly AccountProfile[] => {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return accounts
  return accounts.filter(account => {
    const models = catalog?.instanceId === account.instanceId ? catalog.models.flatMap(model => [model.id, model.name]) : []
    const text = [
      account.displayName,
      account.instanceId,
      KIND_LABEL[account.kind],
      account.identity,
      account.plan,
      ...account.additionalModelIds,
      ...account.favoriteModelIds,
      ...account.hiddenModelIds,
      ...account.modelOrder,
      ...models,
    ]
      .join(' ')
      .toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}

/**
 * The page heading's count (DESIGN.md Counts): every row the unfiltered list shows, the saved accounts and the
 * built-in providers listed under them. The built-ins count only once their list answered and is available.
 */
export const accountsPageCount = (input: {
  readonly accounts: readonly unknown[]
  readonly native: { readonly available: boolean; readonly providers: readonly unknown[] } | undefined
}): number => input.accounts.length + (input.native?.available === true ? input.native.providers.length : 0)
