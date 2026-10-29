import { defineContract, useContract } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface AccountUsageViewProps {
  /** Exact recorded provider route, including account instance id; native routes use the same field. */
  readonly accountId: string
  readonly displayName: string
  readonly onOpenUsageHistory: () => void
}

/**
 * The per-account usage dashboard. usage records the requests and already depends on ai-accounts, so it provides the
 * view here instead of ai-accounts importing usage, which would make the two bundles build each other.
 */
export const AccountUsageView = defineContract<{ readonly Dashboard: ComponentType<AccountUsageViewProps> }>('@dshfiles/ai-accounts.account-usage-view', {
  owner: '@dshfiles/usage',
})

/** Renders nothing while usage is absent or disabled: the account page stays usable without it. */
export const AccountUsageSlot = (props: AccountUsageViewProps): JSX.Element | null => {
  const view = useContract(AccountUsageView)
  if (view.status !== 'active') return null
  return <view.value.Dashboard {...props} />
}
