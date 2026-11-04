import { defineContract } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/**
 * Observe › Usage › Quota (plans/ade-ux §6 "Cost/usage in 4–6 places"). `@dshfiles/usage` owns the one Usage page; the
 * quota views stay ai-accounts' code because they read its quota store.
 *
 * Why ai-accounts declares these tokens instead of usage declaring a registry: usage already imports ai-accounts (price
 * catalog, cost estimate, the accounts API on its Host), so ai-accounts depending on usage would close a cycle
 * (docs/plugin-boundaries.md; `pnpm check:cycles`). The dependency stays one way, usage → ai-accounts:
 *
 * - `AccountQuotaViews` is provided by ai-accounts and rendered by usage, which shows nothing when ai-accounts is absent.
 * - `UsageNavigation` is provided by usage, so ai-accounts' old entry points (the quota strip, the account Usage tab,
 *   saved tabs of the former Usage history and Quota forecast pages) open Usage › Quota; without usage they fall back
 *   to ai-accounts' own pages.
 *
 * Published as the `@dshfiles/ai-accounts/quota-views` dshx module; importing it loads no ai-accounts UI.
 */

/** The three quota views of Usage › Quota. */
export type UsageQuotaView = 'accounts' | 'history' | 'forecast'

export const USAGE_QUOTA_VIEWS: readonly UsageQuotaView[] = ['accounts', 'history', 'forecast']

/** Where to land in Usage › Quota; `accountId` preselects one account in the views that show one. */
export interface UsageQuotaTarget {
  readonly view?: UsageQuotaView
  /** Exact recorded provider route, including the account instance id; native routes use the same field. */
  readonly accountId?: string
  readonly displayName?: string
}

export interface QuotaViewProps {
  /** Preselected account; the view keeps its own picker. */
  readonly accountId?: string
  readonly displayName?: string
}

export interface AccountQuotaViewsValue {
  /** One account: its current limits and, when usage runs, its recorded requests and cost. */
  readonly Accounts: ComponentType<QuotaViewProps>
  /** Quota snapshots, observed depletion pace and banked resets over time. */
  readonly History: ComponentType<QuotaViewProps>
  /** When each account runs out, coverage and the order to use them in. */
  readonly Forecast: ComponentType<QuotaViewProps>
}

export const AccountQuotaViews = defineContract<AccountQuotaViewsValue>('@dshfiles/ai-accounts.quota-views', { owner: '@dshfiles/ai-accounts' })

export interface UsageNavigationService {
  /** Select the Usage page on the Quota tab. */
  readonly openQuota: (target?: UsageQuotaTarget) => void
}

export const UsageNavigation = defineContract<UsageNavigationService>('@dshfiles/ai-accounts.usage-navigation', { owner: '@dshfiles/usage' })
