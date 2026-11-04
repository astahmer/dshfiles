import { useContract } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { UsageNavigation, type UsageQuotaTarget } from './quota-views.js'

/**
 * The account page's Usage tab while `@dshfiles/usage` runs: an alias of Observe › Usage › Quota › Accounts for this
 * account (plans/ade-ux §6). `open()` returns false when usage is absent, so the tab keeps its own content then.
 */
export const useUsageRedirect = (target: Omit<UsageQuotaTarget, 'view'> | undefined): { readonly active: boolean; readonly open: () => boolean } => {
  const navigation = useContract(UsageNavigation)
  const active = navigation.status === 'active'
  return {
    active,
    open: () => {
      if (navigation.status !== 'active') return false
      navigation.value.openQuota({ view: 'accounts', ...target })
      return true
    },
  }
}

export const UsageMovedNotice = (props: { readonly onOpen: () => void }): JSX.Element => (
  <EmptyState action={{ label: 'Open in Usage', onSelect: () => void props.onOpen() }}>
    This account's requests, cost and quota are in Observe › Usage › Quota.
  </EmptyState>
)
